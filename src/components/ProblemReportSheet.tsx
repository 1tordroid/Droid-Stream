import React, {useEffect, useState} from 'react';
import {Linking, ToastAndroid} from 'react-native';
import {copyText} from '../lib/clipboard';
import {buildProblemReport, readRecentLogs, REPORT_LOG_LINES} from '../lib/problemReport';
import {Sheet, SheetNote, SheetRow} from '../screens/browser/Sheet';

const toast = (message: string) => ToastAndroid.show(message, ToastAndroid.SHORT);

/**
 * Asks whether to add logs, then opens a prefilled GitHub issue. The user
 * reads and sends it on GitHub; the app sends nothing.
 */
const ProblemReportSheet = ({visible, onClose, error}: {visible: boolean; onClose: () => void; error?: {message?: string; stack?: string}}) => {
  const [includeLogs, setIncludeLogs] = useState(false);
  const [busy, setBusy] = useState(false);
  const [leftOut, setLeftOut] = useState<{text: string; count: number} | null>(null);

  // Every report starts without logs.
  useEffect(() => {
    if (!visible) return;
    setIncludeLogs(false);
    setLeftOut(null);
  }, [visible]);

  const open = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const logs = includeLogs ? await readRecentLogs().catch(() => [] as string[]) : undefined;
      const report = buildProblemReport({logs, error});
      await Linking.openURL(report.url);
      if (report.trimmed) {
        // The sheet stays open so the full logs can be copied and pasted.
        setLeftOut({text: report.logText, count: report.logText.split('\n').length - report.logLines});
      } else {
        onClose();
      }
    } catch {
      toast('Could not open GitHub');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Send a problem report">
      <SheetNote>
        Opens a new GitHub issue with the app version, Android version and phone model filled in. You can read and change all of it before you send it. The app sends nothing by itself.
      </SheetNote>
      <SheetRow
        icon="text-box-search-outline"
        label="Include recent logs"
        detail={`The last ${REPORT_LOG_LINES} lines, without sign-ins, cookies, emails, IP addresses, link details or file paths`}
        toggle={includeLogs}
        onPress={() => {
          setIncludeLogs(value => !value);
          setLeftOut(null);
        }}
      />
      <SheetRow icon="github" label={busy ? 'Opening…' : 'Open GitHub issue'} disabled={busy} onPress={open} preferredFocus />
      {leftOut ? (
        <>
          <SheetNote>
            The logs were too long for the link, so {leftOut.count} older lines were left out. Copy the logs and paste them into the issue.
          </SheetNote>
          <SheetRow
            icon="content-copy"
            label="Copy logs"
            onPress={() => {
              copyText(leftOut.text);
              toast('Logs copied');
            }}
          />
        </>
      ) : null}
      <SheetRow icon="close" label={leftOut ? 'Done' : 'Cancel'} onPress={onClose} />
    </Sheet>
  );
};

export default ProblemReportSheet;
