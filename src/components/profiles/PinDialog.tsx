import React, {useEffect, useState} from 'react';
import {Modal, View} from 'react-native';
import {pinCheckMessage} from '../../lib/profiles/pin';
import {tryProfilePin} from '../../lib/profiles/profiles';
import {useM3Colors} from '../../theme/M3PaletteContext';
import PinPad from './PinPad';

export type PinDialogRequest =
  /** Check the saved PIN of a profile. */
  | {kind: 'verify'; profileId: string; title: string; onDone: () => void}
  /** Ask for a new PIN twice. */
  | {kind: 'create'; title: string; onDone: (pin: string) => void};

/** Full-screen PIN pad over the current screen. Closed when [request] is undefined. */
const PinDialog = ({request, onClose}: {request?: PinDialogRequest; onClose: () => void}) => {
  const colors = useM3Colors();
  const [first, setFirst] = useState<string>();
  const [notice, setNotice] = useState<string>();

  useEffect(() => {
    setFirst(undefined);
    setNotice(undefined);
  }, [request]);

  if (!request) return null;

  const title = request.kind === 'create' && first ? 'Enter the new PIN again' : request.title;
  return (
    <Modal visible animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={{flex: 1, backgroundColor: colors.background, justifyContent: 'center', padding: 24}}>
        <PinPad
          key={first ? 'confirm' : 'first'}
          title={title}
          message={notice}
          onCancel={onClose}
          onComplete={pin => {
            if (request.kind === 'verify') {
              const result = tryProfilePin(request.profileId, pin);
              if (!result.ok) return pinCheckMessage(result);
              onClose();
              request.onDone();
              return undefined;
            }
            if (!first) {
              setFirst(pin);
              setNotice(undefined);
              return undefined;
            }
            if (first !== pin) {
              setFirst(undefined);
              setNotice('The PINs did not match. Try again.');
              return undefined;
            }
            onClose();
            request.onDone(pin);
            return undefined;
          }}
        />
      </View>
    </Modal>
  );
};

export default PinDialog;
