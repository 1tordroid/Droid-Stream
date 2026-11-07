import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React, {useState} from 'react';
import {Linking, Pressable, ToastAndroid, View} from 'react-native';
import Button from '../../components/ui/Button';
import AppText from '../../components/ui/Text';
import {versionWithBuild} from '../../lib/appVersion';
import {buildSiteIssueUrl} from '../../lib/social/rules/report';
import {socialRulesInfo} from '../../lib/social/rules/update';
import type {SocialSite} from '../../lib/social/types';
import {useM3Colors} from '../../theme/M3PaletteContext';

/**
 * "This site stopped working": opens a new GitHub issue with the site, the
 * app and rules versions and the error. The post link goes in only when the
 * person ticks the box.
 */
const SiteReport = ({
  site,
  error,
  postUrl,
  hide,
}: {
  site: SocialSite;
  error?: string;
  postUrl?: string;
  /** User names and ids in the error text, hidden unless the link is shared. */
  hide?: (string | undefined)[];
}) => {
  const colors = useM3Colors();
  const [includeLink, setIncludeLink] = useState(false);

  const report = () => {
    const url = buildSiteIssueUrl({
      site,
      appVersion: versionWithBuild(),
      rulesVersion: socialRulesInfo().version,
      error,
      postUrl,
      includeLink,
      hide,
    });
    Linking.openURL(url).catch(() => ToastAndroid.show('Could not open the browser', ToastAndroid.SHORT));
  };

  return (
    <View style={{marginTop: 8}}>
      {postUrl ? (
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{checked: includeLink}}
          accessibilityLabel="Include the post link"
          onPress={() => setIncludeLink(value => !value)}
          style={{flexDirection: 'row', alignItems: 'center', minHeight: 48, gap: 12}}>
          <MaterialCommunityIcons
            name={includeLink ? 'checkbox-marked' : 'checkbox-blank-outline'}
            size={24}
            color={includeLink ? colors.primary : colors.onSurfaceVariant}
          />
          <View style={{flex: 1}}>
            <AppText role="bodyLarge" style={{color: colors.onSurface}}>Include the post link</AppText>
            <AppText role="bodySmall" style={{color: colors.onSurfaceVariant}}>The report is public on GitHub</AppText>
          </View>
        </Pressable>
      ) : null}
      <View style={{flexDirection: 'row', justifyContent: 'flex-end'}}>
        <Button variant="text" compact onPress={report}>This site stopped working</Button>
      </View>
    </View>
  );
};

export default SiteReport;
