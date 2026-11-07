import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React, {useEffect, useRef, useState} from 'react';
import {ActivityIndicator, View} from 'react-native';
import {TVFocusable} from '../tv';
import Button from '../ui/Button';
import AppText from '../ui/Text';
import SignInCode from './SignInCode';
import {
  checkPlexPin,
  chooseConnection,
  listPlexServers,
  PLEX_LINK_URL,
  startPlexPin,
  type PlexLinkResult,
  type PlexServer,
} from '../../lib/sources/plexLink';
import {startDevicePoll} from '../../lib/watchSync/devicePoll';
import type {DeviceCode} from '../../lib/watchSync';
import {isTV} from '../../lib/tv/constants';
import {useM3Colors} from '../../theme/M3PaletteContext';

type Phase =
  | {step: 'start'}
  | {step: 'busy'; message: string}
  | {step: 'code'; code: DeviceCode}
  | {step: 'servers'; servers: PlexServer[]}
  /** server: the one that could not be reached, to try again without a new code. */
  | {step: 'error'; message: string; server?: PlexServer};

/**
 * Plex sign-in with a code on plex.tv/link, then a choice of server when
 * the account has more than one. Calls onSignedIn with the server and the
 * address that answered.
 */
const PlexSignIn = ({
  clientId,
  onSignedIn,
  preferFocus = false,
}: {
  clientId: string;
  onSignedIn: (link: PlexLinkResult) => void;
  /** TV: start on the Get a code button, when nothing above it takes focus. */
  preferFocus?: boolean;
}) => {
  const colors = useM3Colors();
  const [phase, setPhase] = useState<Phase>({step: 'start'});
  // Bumped on every new start and on unmount, so an older run cannot change the screen.
  const run = useRef(0);
  const cancelPoll = useRef<(() => void) | undefined>(undefined);
  const servers = useRef<PlexServer[]>([]);

  useEffect(
    () => () => {
      run.current += 1;
      cancelPoll.current?.();
    },
    [],
  );

  const pick = async (server: PlexServer, current = run.current) => {
    setPhase({step: 'busy', message: `Connecting to ${server.name}…`});
    const connection = await chooseConnection(server);
    if (current !== run.current) return;
    if (!connection) {
      setPhase({step: 'error', message: `Could not reach ${server.name}. Check that it is on, or sign in with its address.`, server});
      return;
    }
    onSignedIn({server, connection, clientId});
  };

  const loadServers = async (token: string, current: number) => {
    setPhase({step: 'busy', message: 'Finding your servers…'});
    try {
      const found = await listPlexServers(token, clientId);
      if (current !== run.current) return;
      servers.current = found;
      if (!found.length) setPhase({step: 'error', message: 'This Plex account has no servers.'});
      else if (found.length === 1) await pick(found[0], current);
      else setPhase({step: 'servers', servers: found});
    } catch (error: any) {
      if (current === run.current) setPhase({step: 'error', message: error?.message || 'Could not list your Plex servers.'});
    }
  };

  const start = async () => {
    cancelPoll.current?.();
    const current = ++run.current;
    setPhase({step: 'busy', message: 'Getting a code…'});
    try {
      const code = await startPlexPin(clientId);
      if (current !== run.current) return;
      setPhase({step: 'code', code});
      let token = '';
      cancelPoll.current = startDevicePoll(code, {
        poll: async next => {
          const answer = await checkPlexPin(next, clientId);
          if (answer.token) token = answer.token;
          return answer.result;
        },
        onApproved: () => {
          if (current === run.current) loadServers(token, current);
        },
        onStop: message => {
          if (current === run.current) setPhase({step: 'error', message});
        },
      });
    } catch (error: any) {
      if (current === run.current) setPhase({step: 'error', message: error?.message || 'Could not get a code. Try again.'});
    }
  };

  if (phase.step === 'start') {
    return (
      <View style={{marginBottom: 12}}>
        <AppText role="bodyMedium" style={{color: colors.onSurfaceVariant, marginBottom: 12}}>
          Get a code, then enter it at plex.tv/link on your phone or computer. No password needed here.
        </AppText>
        <View style={{flexDirection: 'row'}}>
          <Button onPress={start} hasTVPreferredFocus={isTV && preferFocus}>Get a code</Button>
        </View>
      </View>
    );
  }
  if (phase.step === 'busy') {
    return (
      <View style={{flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 16}}>
        <ActivityIndicator color={colors.primary} />
        <AppText role="bodyLarge" style={{color: colors.onSurface}}>{phase.message}</AppText>
      </View>
    );
  }
  if (phase.step === 'code') {
    return (
      <SignInCode
        code={phase.code.userCode}
        before={`Scan the QR code, or go to ${PLEX_LINK_URL.replace(/^https:\/\//, '')} and enter`}
        qrValue={PLEX_LINK_URL}
        status="Waiting for you to enter the code…"
        action={{label: 'Get a new code', onPress: start}}
      />
    );
  }
  if (phase.step === 'servers') {
    return (
      <View style={{marginVertical: 8}}>
        <AppText role="titleMedium" style={{color: colors.onSurface, marginBottom: 8}}>Pick a server</AppText>
        {phase.servers.map((server, index) => (
          <TVFocusable
            key={server.id || server.name}
            accessibilityRole="button"
            accessibilityLabel={`Use ${server.name}`}
            hasTVPreferredFocus={isTV && index === 0}
            borderRadius={16}
            onPress={() => pick(server)}
            style={{flexDirection: 'row', alignItems: 'center', minHeight: 64, padding: 14, marginBottom: 8, borderRadius: 16, backgroundColor: colors.surfaceContainer}}>
            <MaterialCommunityIcons name="plex" size={24} color={colors.primary} style={{marginRight: 12}} />
            <View style={{flex: 1}}>
              <AppText role="titleMedium" numberOfLines={1} style={{color: colors.onSurface}}>{server.name}</AppText>
              <AppText role="bodySmall" style={{color: colors.onSurfaceVariant}}>{server.owned ? 'Your server' : 'Shared with you'}</AppText>
            </View>
          </TVFocusable>
        ))}
      </View>
    );
  }
  return (
    <View style={{marginVertical: 12}}>
      <AppText role="bodyLarge" style={{color: colors.error, marginBottom: 12}}>{phase.message}</AppText>
      <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 12}}>
        {phase.server ? (
          <Button onPress={() => pick(phase.server!)} hasTVPreferredFocus={isTV}>Try again</Button>
        ) : (
          <Button onPress={start} hasTVPreferredFocus={isTV}>Get a new code</Button>
        )}
        {servers.current.length > 1 ? (
          <Button variant="tonal" onPress={() => setPhase({step: 'servers', servers: servers.current})}>Pick another server</Button>
        ) : null}
      </View>
    </View>
  );
};

export default PlexSignIn;
