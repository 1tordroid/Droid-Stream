import {findNodeHandle, UIManager, type HostInstance} from 'react-native';

/**
 * Native view tag for a mounted host instance (pass `ref.current`, not the
 * ref), or null when it is not mounted. The explicit type matters: the
 * generated `findNodeHandle` parameter type collapses to `unknown`, so a ref
 * object would type-check and then throw at runtime.
 */
export function getNodeHandle(
  target: HostInstance | number | null | undefined,
): number | null {
  if (target == null) {
    return null;
  }
  return findNodeHandle(target) ?? null;
}

/**
 * Moves TV focus to a native view. react-native-tvos takes the command by
 * name; the generated React Native types only describe numeric command ids.
 */
export function requestTVFocusByHandle(
  handle: number | null | undefined,
): void {
  if (handle == null) {
    return;
  }
  UIManager.dispatchViewManagerCommand(
    handle,
    'requestTVFocus' as unknown as number,
    [],
  );
}
