import React, {useState} from 'react';
import {ToastAndroid, View} from 'react-native';
import Button from '../../components/ui/Button';
import AppText from '../../components/ui/Text';
import {checkSocialRules, socialRulesInfo} from '../../lib/social/rules/update';
import type {SocialSite} from '../../lib/social/types';
import {SITE_LABELS} from '../../lib/social/urls';
import {useM3Colors} from '../../theme/M3PaletteContext';
import {Choice, Section} from '../ytdl/components';
import SiteReport from './SiteReport';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-11-07" as "7 Nov 2026". */
export const formatRulesDay = (day: string): string => {
  const [year, month, date] = day.split('-').map(Number);
  return MONTHS[month - 1] ? `${date} ${MONTHS[month - 1]} ${year}` : day;
};

const SITES = (Object.keys(SITE_LABELS) as SocialSite[]).map(value => ({value, label: SITE_LABELS[value]}));

/** Settings for the photo downloader's site rules: version, "Check now" and reporting a site. */
const SocialRulesSection = () => {
  const colors = useM3Colors();
  const [info, setInfo] = useState(socialRulesInfo);
  const [checking, setChecking] = useState(false);
  const [site, setSite] = useState<SocialSite>('instagram');

  const checkNow = async () => {
    setChecking(true);
    try {
      const result = await checkSocialRules({force: true});
      setInfo(socialRulesInfo());
      ToastAndroid.show(
        result.status === 'updated'
          ? `Updated to site rules version ${result.version}`
          : result.status === 'failed'
            ? 'Could not get new site rules. The current ones stay.'
            : 'Site rules are up to date',
        ToastAndroid.SHORT,
      );
    } finally {
      setChecking(false);
    }
  };

  return (
    <Section title="Photos from posts" hint="Site rules tell the app how to read each site. Fixes arrive without an app update, signed by Droid Stream.">
      <AppText role="bodyMedium" style={{color: colors.onSurface}}>
        {`Site rules version ${info.version} (updated ${formatRulesDay(info.updated)})`}
      </AppText>
      <View style={{flexDirection: 'row', justifyContent: 'flex-end', marginTop: 12}}>
        <Button variant="tonal" compact disabled={checking} onPress={checkNow}>
          {checking ? 'Checking…' : 'Check now'}
        </Button>
      </View>
      <AppText role="labelMedium" style={{color: colors.onSurfaceVariant, marginTop: 12, marginBottom: 8}}>
        A site stopped working?
      </AppText>
      <Choice options={SITES} value={site} onChange={setSite} />
      <SiteReport site={site} />
    </Section>
  );
};

export default SocialRulesSection;
