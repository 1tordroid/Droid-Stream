"""Droid Stream's bridge between the app and yt-dlp.

Written for Droid Stream. It loads yt-dlp from a folder the app manages
(the bundled release or one downloaded by "Update yt-dlp"), runs info
lookups and downloads, and reports progress to the Kotlin side.

yt-dlp runs ffmpeg and ffprobe as programs. Android apps cannot run the
FFmpegKit library as a program, so the two names point at placeholder files
in the app's own folder, and yt-dlp's process class hands those commands to
FFmpegKit through the bridge instead of starting a process. Every other
command is left alone.

YouTube needs a JavaScript runtime to solve its player challenges. A small
challenge provider sends the solver script to the Kotlin side, which runs it
in Android's JavaScript sandbox (the WebView V8 engine in its own process).
"""

import io
import json
import os
import subprocess
import sys
import threading
import time

_bridge = None
_bin_dir = None
_active_dir = None
_local = threading.local()
_cancelled = set()
_cancel_lock = threading.Lock()
_PROGRESS_INTERVAL = 0.25


def _log(message):
    try:
        _bridge.log(str(message))
    except Exception:
        pass


# --- Loading yt-dlp ---------------------------------------------------------


def setup(bridge, bin_dir, cert_file):
    """Called once per process before anything else."""
    global _bridge, _bin_dir
    _bridge = bridge
    _bin_dir = os.path.abspath(bin_dir)
    sys.dont_write_bytecode = False
    if cert_file and os.path.exists(cert_file):
        os.environ['SSL_CERT_FILE'] = cert_file
    return sys.version.split()[0]


def activate(directory):
    """Loads yt-dlp from directory, replacing any version loaded before."""
    global _active_dir
    directory = os.path.abspath(directory)
    for name in list(sys.modules):
        if name in ('yt_dlp', 'yt_dlp_ejs') or name.startswith(('yt_dlp.', 'yt_dlp_ejs.')):
            del sys.modules[name]
    if _active_dir and _active_dir in sys.path:
        sys.path.remove(_active_dir)
    sys.path.insert(0, directory)
    _active_dir = directory
    import yt_dlp  # noqa: F401
    from yt_dlp.version import __version__
    _patch_process_class()
    _register_js_provider()
    return __version__


# --- ffmpeg through FFmpegKit ---------------------------------------------


def _kit_tool(args):
    if not isinstance(args, (list, tuple)) or not args or not _bin_dir:
        return None
    program = str(args[0])
    if os.path.dirname(os.path.abspath(program)) != _bin_dir:
        return None
    name = os.path.basename(program)
    return name if name in ('ffmpeg', 'ffprobe') else None


class _NullInput:
    def write(self, data):
        return len(data)

    def flush(self):
        pass

    def close(self):
        pass


class _KitProcess:
    """Just enough of subprocess.Popen for yt-dlp's ffmpeg and ffprobe calls."""

    def __init__(self, tool, args, kwargs):
        self.args = list(args)
        self.pid = 0
        self.returncode = None
        self._tool = tool
        self._text = bool(kwargs.get('text') or kwargs.get('universal_newlines')
                          or kwargs.get('encoding') or kwargs.get('errors'))
        # yt-dlp's Popen.run reads this name-mangled attribute.
        self._Popen__text_mode = self._text
        self._pipe_out = kwargs.get('stdout') == subprocess.PIPE
        self._pipe_err = kwargs.get('stderr') == subprocess.PIPE
        self._job = getattr(_local, 'job', '') or ''
        self._output = ''
        self.stdin = _NullInput()
        self.stdout = None
        self.stderr = None

    def _arguments(self):
        rest = [str(arg) for arg in self.args[1:]]
        quiet = any(arg in ('-v', '-loglevel') for arg in rest)
        machine = any(arg in ('-print_format', '-of', '-show_streams', '-show_format', '-show_entries') for arg in rest)
        # FFmpegKit returns stdout and the log as one text. ffprobe's data goes
        # to stdout, so keep the log quiet when yt-dlp parses that data.
        if self._tool == 'ffprobe' and machine and not quiet:
            rest = ['-v', 'error', *rest]
        return rest

    def _run(self):
        if self.returncode is not None:
            return
        result = json.loads(str(_bridge.runFfmpeg(self._job, self._tool, json.dumps(self._arguments()))))
        self._output = result.get('output') or ''
        self.returncode = int(result.get('code', 1))
        if self._pipe_out:
            self.stdout = io.StringIO(self._output) if self._text else io.BytesIO(self._output.encode())
        if self._pipe_err:
            self.stderr = io.StringIO(self._output) if self._text else io.BytesIO(self._output.encode())

    def _value(self, wanted):
        if not wanted:
            return None
        return self._output if self._text else self._output.encode('utf-8', 'replace')

    def communicate(self, input=None, timeout=None):
        self._run()
        return self._value(self._pipe_out), self._value(self._pipe_err)

    def communicate_or_kill(self, *args, **kwargs):
        return self.communicate(*args, **kwargs)

    def wait(self, timeout=None):
        self._run()
        return self.returncode

    def poll(self):
        self._run()
        return self.returncode

    def kill(self, *, timeout=0):
        if self._job:
            _bridge.cancelFfmpeg(self._job)

    def terminate(self):
        self.kill()

    def send_signal(self, _signal):
        self.kill()

    def __enter__(self):
        return self

    def __exit__(self, *_exc):
        return False


def _patch_process_class():
    from yt_dlp.utils import _utils
    popen = _utils.Popen
    if popen.__dict__.get('_droidstream_patched'):
        return

    def __new__(cls, args, *rest, **kwargs):
        tool = _kit_tool(args)
        if tool:
            return _KitProcess(tool, args, kwargs)
        return object.__new__(cls)

    popen.__new__ = staticmethod(__new__)
    popen._droidstream_patched = True


# --- JavaScript challenges --------------------------------------------------


def _register_js_provider():
    try:
        from yt_dlp.extractor.youtube.jsc._builtin.ejs import EJSBaseJCP
        from yt_dlp.extractor.youtube.jsc.provider import register_preference, register_provider
        from yt_dlp.extractor.youtube.pot._provider import BuiltinIEContentProvider
    except Exception as error:  # A future yt-dlp may move these.
        _log(f'JavaScript challenge provider unavailable: {error}')
        return False

    class DroidStreamJCP(EJSBaseJCP, BuiltinIEContentProvider):
        PROVIDER_NAME = 'droidstream'
        JS_RUNTIME_NAME = 'android-sandbox'

        def is_available(self, /):
            try:
                return bool(_bridge.jsAvailable()) and self._available
            except Exception:
                return False

        def _run_js_runtime(self, stdin, /):
            return str(_bridge.runJs(stdin))

    try:
        register_provider(DroidStreamJCP)
        register_preference(DroidStreamJCP)(lambda provider, requests: 1000)
    except AssertionError:
        pass
    return True


# --- Info ------------------------------------------------------------------


def _base_options(cookie_file):
    options = {
        'quiet': True,
        'no_warnings': False,
        'noprogress': True,
        'logger': _Logger(),
        'ffmpeg_location': _bin_dir,
        'js_runtimes': {},
    }
    if cookie_file and os.path.exists(cookie_file):
        options['cookiefile'] = cookie_file
    return options


class _Logger:
    def __init__(self):
        self.lines = []

    def _keep(self, message):
        self.lines.append(str(message))
        del self.lines[:-40]

    def debug(self, message):
        if not str(message).startswith('[debug] '):
            self._keep(message)

    def info(self, message):
        self._keep(message)

    def warning(self, message):
        self._keep(message)
        _log(f'WARNING: {message}')

    def error(self, message):
        self._keep(message)
        _log(message)


def _format(item):
    return {
        'id': item.get('format_id'),
        'ext': item.get('ext'),
        'width': item.get('width'),
        'height': item.get('height'),
        'fps': item.get('fps'),
        'vcodec': item.get('vcodec'),
        'acodec': item.get('acodec'),
        'filesize': item.get('filesize') or item.get('filesize_approx'),
        'tbr': item.get('tbr'),
        'abr': item.get('abr'),
        'note': item.get('format_note'),
        'protocol': item.get('protocol'),
        'dynamicRange': item.get('dynamic_range'),
        'language': item.get('language'),
    }


def _entry(item, index):
    url = item.get('webpage_url') or item.get('url') or item.get('original_url')
    thumbnails = item.get('thumbnails') or []
    thumbnail = item.get('thumbnail') or (thumbnails[-1].get('url') if thumbnails else None)
    return {
        'index': index,
        'id': item.get('id'),
        'title': item.get('title') or item.get('id') or f'Item {index}',
        'url': url,
        'duration': item.get('duration'),
        'thumbnail': thumbnail,
        'uploader': item.get('uploader') or item.get('channel'),
    }


def extract(url, cookie_file):
    """Title, thumbnail, formats and subtitles, or the items of a playlist."""
    import yt_dlp
    options = _base_options(cookie_file)
    options['extract_flat'] = 'in_playlist'
    options['skip_download'] = True
    with yt_dlp.YoutubeDL(options) as ydl:
        info = ydl.sanitize_info(ydl.extract_info(url, download=False))
    if info.get('_type') in ('playlist', 'multi_video'):
        entries = [_entry(item or {}, index + 1) for index, item in enumerate(info.get('entries') or [])]
        return json.dumps({
            'type': 'playlist',
            'id': info.get('id'),
            'title': info.get('title') or 'Playlist',
            'uploader': info.get('uploader') or info.get('channel'),
            'webpageUrl': info.get('webpage_url') or url,
            'extractor': info.get('extractor_key') or info.get('extractor'),
            'entries': [entry for entry in entries if entry['url']],
        })
    subtitles = info.get('subtitles') or {}
    automatic = info.get('automatic_captions') or {}
    return json.dumps({
        'type': 'video',
        'id': info.get('id'),
        'title': info.get('title') or info.get('id') or 'Video',
        'uploader': info.get('uploader') or info.get('channel'),
        'duration': info.get('duration'),
        'thumbnail': info.get('thumbnail'),
        'webpageUrl': info.get('webpage_url') or url,
        'extractor': info.get('extractor_key') or info.get('extractor'),
        'isLive': bool(info.get('is_live')),
        'chapters': len(info.get('chapters') or []),
        'formats': [_format(item) for item in (info.get('formats') or [])],
        'subtitles': {lang: (tracks[0].get('name') if tracks else None) for lang, tracks in subtitles.items() if lang != 'live_chat'},
        # Original-language captions first, then the machine translations.
        'automaticCaptions': sorted(automatic.keys(), key=lambda lang: (not lang.endswith('-orig'), lang))[:200],
        'originalLanguage': info.get('language'),
    })


# --- Download ----------------------------------------------------------------


def cancel(job_id):
    with _cancel_lock:
        _cancelled.add(job_id)


def _is_cancelled(job_id):
    with _cancel_lock:
        return job_id in _cancelled


def _planned(info):
    formats = info.get('requested_formats') or [info]
    total = 0
    for item in formats:
        size = item.get('filesize') or item.get('filesize_approx')
        if not size:
            return 0, len(formats)
        total += size
    return total, len(formats)


def download(job_id, url, args_json, work_dir, cookie_file, listener):
    """Downloads one item into work_dir. Returns the files as JSON."""
    import yt_dlp
    from yt_dlp.utils import DownloadCancelled

    with _cancel_lock:
        _cancelled.discard(job_id)
    _local.job = job_id
    args = [str(arg) for arg in json.loads(args_json)]
    try:
        options = yt_dlp.parse_options([*args, '--', url]).ydl_opts
    except BaseException as error:  # optparse exits on a bad option
        return json.dumps({'error': f'Invalid yt-dlp arguments: {error}'})
    options.update(_base_options(cookie_file))
    logger = options['logger']
    options['paths'] = {'home': work_dir, 'temp': work_dir}
    outtmpl = options.get('outtmpl') if isinstance(options.get('outtmpl'), dict) else {}
    outtmpl = {key: value for key, value in outtmpl.items() if key in ('chapter', 'pl_video')}
    outtmpl['default'] = 'media.%(ext)s'
    options['outtmpl'] = outtmpl
    options['noplaylist'] = True
    # The command line skips failed post-processing; a failed merge or
    # conversion must fail the download here instead of saving half a file.
    options['ignoreerrors'] = False
    os.makedirs(work_dir, exist_ok=True)

    last = {'at': 0.0}
    # Sizes of every file the download will fetch (a video and its audio are
    # separate downloads), learned before the first byte.
    plan = {'planned': 0, 'parts': 1}

    def report(event):
        listener.onEvent(job_id, json.dumps(event))

    def progress_hook(data):
        if _is_cancelled(job_id):
            raise DownloadCancelled('Download cancelled')
        status = data.get('status')
        now = time.monotonic()
        if status == 'downloading' and now - last['at'] < _PROGRESS_INTERVAL:
            return
        last['at'] = now
        info = data.get('info_dict') or {}
        report({
            'type': 'progress',
            'status': status,
            'file': os.path.basename(data.get('filename') or data.get('tmpfilename') or ''),
            'formatId': info.get('format_id'),
            'downloaded': data.get('downloaded_bytes') or 0,
            'total': data.get('total_bytes') or data.get('total_bytes_estimate') or 0,
            'speed': data.get('speed') or 0,
            'eta': data.get('eta'),
            'fragment': data.get('fragment_index'),
            'fragments': data.get('fragment_count'),
            'planned': plan['planned'],
            'parts': plan['parts'],
        })

    def postprocessor_hook(data):
        if _is_cancelled(job_id):
            raise DownloadCancelled('Download cancelled')
        name = data.get('postprocessor') or ''
        if not name.startswith('_'):  # skip the size planner (_Plan)
            report({'type': 'postprocess', 'status': data.get('status'), 'name': name})

    options['progress_hooks'] = [progress_hook]
    options['postprocessor_hooks'] = [postprocessor_hook]

    from yt_dlp.postprocessor.common import PostProcessor

    class _Plan(PostProcessor):
        def run(self, info):
            plan['planned'], plan['parts'] = _planned(info)
            return [], info

    try:
        with yt_dlp.YoutubeDL(options) as ydl:
            ydl.add_post_processor(_Plan(ydl), when='before_dl')
            info = ydl.extract_info(url, download=True)
            info = ydl.sanitize_info(info) if info else {}
    except DownloadCancelled:
        return json.dumps({'cancelled': True})
    except BaseException as error:
        if _is_cancelled(job_id):
            return json.dumps({'cancelled': True})
        message = str(error) or (logger.lines[-1] if logger.lines else 'yt-dlp failed')
        return json.dumps({'error': message, 'log': logger.lines[-12:]})
    finally:
        with _cancel_lock:
            _cancelled.discard(job_id)
        _local.job = ''

    downloads = info.get('requested_downloads') or []
    media = None
    for item in reversed(downloads):
        if item.get('filepath') and os.path.exists(item['filepath']):
            media = item['filepath']
            break
    if not media and info.get('filepath') and os.path.exists(info['filepath']):
        media = info['filepath']
    if not media:
        candidates = [
            os.path.join(work_dir, name) for name in os.listdir(work_dir)
            if name.startswith('media.') and not name.endswith(('.part', '.ytdl', '.temp'))
            and name.count('.') == 1
        ]
        media = max(candidates, key=os.path.getsize) if candidates else None
    if not media:
        return json.dumps({'error': 'yt-dlp finished without an output file', 'log': logger.lines[-12:]})
    extras = []
    for name in sorted(os.listdir(work_dir)):
        path = os.path.join(work_dir, name)
        if path != media and name.startswith('media.') and name.endswith(('.srt', '.vtt', '.ass', '.lrc', '.ttml', '.srv3')):
            extras.append(path)
    return json.dumps({
        'file': media,
        'ext': os.path.splitext(media)[1].lstrip('.'),
        'subtitles': extras,
        'title': info.get('title'),
        'thumbnail': info.get('thumbnail'),
        'uploader': info.get('uploader') or info.get('channel'),
        'duration': info.get('duration'),
    })
