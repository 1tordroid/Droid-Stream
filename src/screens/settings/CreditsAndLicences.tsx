import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React, {useCallback, useMemo, useRef} from 'react';
import {FlatList, Linking, ScrollView, ToastAndroid, View, type HostInstance, type ScrollViewInstance} from 'react-native';
import AppText from '../../components/ui/Text';
import {TVFocusable, TVFocusGuide} from '../../components/tv';
import {versionLabel} from '../../lib/appVersion';
import {isTV} from '../../lib/tv';
import {getNodeHandle, requestTVFocusByHandle} from '../../lib/tv/focus';
import {useM3Colors} from '../../theme/M3PaletteContext';
import {
  ALL_SECTIONS,
  type CreditEntry,
  type CreditLink,
  type CreditSection,
  type CreditSectionId,
} from './creditsData';

type Row =
  | {key: string; kind: 'section'; section: CreditSection}
  | {key: string; kind: 'entry'; section: CreditSection; entry: CreditEntry; first: boolean; last: boolean};

/** One flat list of section headers and entries, so the phone list can window it. */
export const buildCreditRows = (sections: CreditSection[] = ALL_SECTIONS): Row[] =>
  sections.flatMap(section => [
    {key: `section:${section.id}`, kind: 'section' as const, section},
    ...section.items.map((entry, index) => ({
      key: `${section.id}:${entry.name}`,
      kind: 'entry' as const,
      section,
      entry,
      first: index === 0,
      last: index === section.items.length - 1,
    })),
  ]);

const openLink = (url: string) => {
  Linking.openURL(url).catch(() => ToastAndroid.show('Could not open the link', ToastAndroid.SHORT));
};

type HandleSink = (handle: number | null) => void;

/** Reports the native handle of a focusable once it is laid out (TV only). */
const useHandleReport = (onHandle?: HandleSink) => {
  const ref = useRef<HostInstance>(null);
  const onLayout = useCallback(() => {
    if (isTV && onHandle) onHandle(getNodeHandle(ref.current));
  }, [onHandle]);
  return {ref, onLayout};
};

const LinkButton = React.memo(
  ({link, entryName, preferred, onHandle}: {link: CreditLink; entryName: string; preferred?: boolean; onHandle?: HandleSink}) => {
    const colors = useM3Colors();
    const {ref, onLayout} = useHandleReport(onHandle);
    return (
      <TVFocusable
        ref={ref}
        onLayout={onLayout}
        hasTVPreferredFocus={isTV && preferred}
        onPress={() => openLink(link.url)}
        accessibilityRole="link"
        accessibilityLabel={`${entryName}, ${link.label}`}
        borderRadius={20}
        style={{
          borderColor: colors.outlineVariant,
          borderRadius: 20,
          borderWidth: 1,
          marginRight: 8,
          marginTop: 8,
        }}>
        <View style={{alignItems: 'center', flexDirection: 'row', minHeight: 40, paddingHorizontal: 14}}>
          <AppText role="labelLarge" style={{color: colors.primary, marginRight: 6}}>
            {link.label}
          </AppText>
          <MaterialCommunityIcons name="open-in-new" size={14} color={colors.primary} />
        </View>
      </TVFocusable>
    );
  },
);

const EntryBody = ({entry}: {entry: CreditEntry}) => {
  const colors = useM3Colors();
  return (
    <>
      <AppText role="bodyLarge" style={{color: colors.onSurface}}>{entry.name}</AppText>
      {entry.license ? (
        <AppText role="labelMedium" style={{color: colors.primary, marginTop: 2}}>{entry.license}</AppText>
      ) : null}
      <AppText role="bodySmall" style={{color: colors.onSurfaceVariant, marginTop: 2}}>{entry.note}</AppText>
      {entry.notice ? (
        <AppText role="bodySmall" selectable style={{color: colors.onSurface, marginTop: 6}}>{entry.notice}</AppText>
      ) : null}
    </>
  );
};

const EntryCard = React.memo(
  ({entry, first, last, preferred, onHandle}: {entry: CreditEntry; first: boolean; last: boolean; preferred?: boolean; onHandle?: HandleSink}) => {
    const colors = useM3Colors();
    const {ref, onLayout} = useHandleReport(entry.links.length ? undefined : onHandle);
    const shell = {
      backgroundColor: colors.surfaceContainer,
      borderColor: colors.outlineVariant,
      borderTopLeftRadius: first ? 16 : 0,
      borderTopRightRadius: first ? 16 : 0,
      borderBottomLeftRadius: last ? 16 : 0,
      borderBottomRightRadius: last ? 16 : 0,
      borderTopWidth: first ? 0 : 1,
      marginBottom: last ? 4 : 0,
    };
    const padding = {paddingHorizontal: 16, paddingVertical: 12};
    if (!entry.links.length) {
      // No link to press. On TV it still takes focus so the D-pad can reach it.
      return isTV ? (
        <View style={shell}>
          <TVFocusable
            ref={ref}
            onLayout={onLayout}
            hasTVPreferredFocus={preferred}
            accessibilityLabel={entry.name}
            borderRadius={12}
            style={padding}>
            <EntryBody entry={entry} />
          </TVFocusable>
        </View>
      ) : (
        <View style={[shell, padding]} accessible accessibilityLabel={entry.name}>
          <EntryBody entry={entry} />
        </View>
      );
    }
    return (
      <View style={[shell, padding]}>
        <EntryBody entry={entry} />
        <View style={{flexDirection: 'row', flexWrap: 'wrap'}}>
          {entry.links.map((link, index) => (
            <LinkButton
              key={`${link.label}:${link.url}`}
              link={link}
              entryName={entry.name}
              preferred={index === 0 && preferred}
              onHandle={index === 0 ? onHandle : undefined}
            />
          ))}
        </View>
      </View>
    );
  },
);

const SectionHeader = ({section}: {section: CreditSection}) => {
  const colors = useM3Colors();
  return (
    <View style={{marginTop: 24, marginBottom: 8}}>
      <AppText role="titleMedium" style={{color: colors.primary}}>{section.title}</AppText>
      <AppText role="bodySmall" style={{color: colors.onSurfaceVariant, marginTop: 2}}>{section.intro}</AppText>
    </View>
  );
};

const JumpChip = ({section, preferred, onPress}: {section: CreditSection; preferred: boolean; onPress: () => void}) => {
  const colors = useM3Colors();
  return (
    <TVFocusable
      hasTVPreferredFocus={isTV && preferred}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Go to ${section.title}`}
      borderRadius={20}
      style={{backgroundColor: colors.secondaryContainer, borderRadius: 20, marginRight: 8, marginTop: 8}}>
      <View style={{justifyContent: 'center', minHeight: 40, paddingHorizontal: 14}}>
        <AppText role="labelLarge" style={{color: colors.onSecondaryContainer}}>{section.shortTitle}</AppText>
      </View>
    </TVFocusable>
  );
};

interface Props {
  route?: {params?: {section?: CreditSectionId}};
  /** Section to open at, used by the old Open-source licences route. */
  initialSection?: CreditSectionId;
}

const CreditsAndLicences = ({route, initialSection}: Props) => {
  const colors = useM3Colors();
  const startSection = route?.params?.section ?? initialSection;
  const rows = useMemo(() => buildCreditRows(), []);
  const listRef = useRef<FlatList<Row>>(null);
  const scrollRef = useRef<ScrollViewInstance>(null);
  // TV: y offset of each section header and the first focusable in it.
  const sectionY = useRef<Partial<Record<CreditSectionId, number>>>({});
  const sectionHandle = useRef<Partial<Record<CreditSectionId, number>>>({});
  const startedAt = useRef(false);
  const scrollRetries = useRef(0);

  const jumpTo = useCallback(
    (id: CreditSectionId) => {
      const index = rows.findIndex(row => row.kind === 'section' && row.section.id === id);
      if (index < 0) return;
      if (isTV) {
        const y = sectionY.current[id];
        if (y != null) scrollRef.current?.scrollTo({y, animated: true});
        const handle = sectionHandle.current[id];
        if (handle != null) setTimeout(() => requestTVFocusByHandle(handle), 250);
        return;
      }
      scrollRetries.current = 0;
      listRef.current?.scrollToIndex({index, animated: true, viewPosition: 0});
    },
    [rows],
  );

  const handleSinks = useMemo(() => {
    const sinks: Partial<Record<CreditSectionId, HandleSink>> = {};
    for (const section of ALL_SECTIONS) {
      sinks[section.id] = handle => {
        if (handle != null) sectionHandle.current[section.id] = handle;
      };
    }
    return sinks;
  }, []);

  const header = (
    <View>
      <AppText role="headlineSmallEmphasized" style={{color: colors.onBackground}}>Credits and licences</AppText>
      <AppText role="bodyMedium" style={{color: colors.onSurfaceVariant, marginTop: 4}}>
        {versionLabel()}. Droid Stream exists thanks to these people and projects.
      </AppText>
      <View style={{flexDirection: 'row', flexWrap: 'wrap', marginTop: 4}}>
        {ALL_SECTIONS.map((section, index) => (
          <JumpChip
            key={section.id}
            section={section}
            preferred={startSection ? false : index === 0}
            onPress={() => jumpTo(section.id)}
          />
        ))}
      </View>
    </View>
  );

  const renderRow = (row: Row) =>
    row.kind === 'section' ? (
      <SectionHeader section={row.section} />
    ) : (
      <EntryCard
        entry={row.entry}
        first={row.first}
        last={row.last}
        preferred={row.first && row.section.id === startSection}
        onHandle={row.first ? handleSinks[row.section.id] : undefined}
      />
    );

  // Phone: open at the requested section once the list has laid out.
  const onListLayout = useCallback(() => {
    if (startedAt.current || !startSection) return;
    startedAt.current = true;
    setTimeout(() => jumpTo(startSection), 0);
  }, [jumpTo, startSection]);

  if (isTV) {
    // Keep every TV focus target attached, as the D-pad needs them mounted.
    return (
      <TVFocusGuide autoFocus={true} trapFocusRight={true} trapFocusDown={true} style={{flex: 1}}>
        <ScrollView
          ref={scrollRef}
          focusable={false}
          accessible={false}
          style={{flex: 1, backgroundColor: colors.background}}
          contentContainerStyle={{padding: 20, paddingBottom: 96}}
          showsVerticalScrollIndicator={false}>
          {header}
          {rows.map(row => (
            <View
              key={row.key}
              onLayout={
                row.kind === 'section'
                  ? event => {
                      sectionY.current[row.section.id] = event.nativeEvent.layout.y;
                    }
                  : undefined
              }>
              {renderRow(row)}
            </View>
          ))}
        </ScrollView>
      </TVFocusGuide>
    );
  }

  return (
    <FlatList
      ref={listRef}
      testID="credits-list"
      style={{flex: 1, backgroundColor: colors.background}}
      contentContainerStyle={{padding: 16, paddingBottom: 96}}
      data={rows}
      keyExtractor={row => row.key}
      renderItem={({item}) => renderRow(item)}
      ListHeaderComponent={header}
      initialNumToRender={14}
      maxToRenderPerBatch={12}
      windowSize={9}
      onLayout={onListLayout}
      onScrollToIndexFailed={info => {
        // Rows have different heights: get close, then try again once rendered.
        listRef.current?.scrollToOffset({offset: info.averageItemLength * info.index, animated: false});
        if (scrollRetries.current >= 5) return;
        scrollRetries.current += 1;
        setTimeout(() => listRef.current?.scrollToIndex({index: info.index, animated: false, viewPosition: 0}), 100);
      }}
    />
  );
};

export default CreditsAndLicences;
