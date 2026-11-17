// Ant Design theme - structural tokens from the house style + a Litra-flavoured palette
// (navy ink, Litra blue as primary, Litra red as the accent used sparingly).

export const BRAND = {
  navy900: '#111833',
  navy800: '#1B2541',
  blue: '#1F4FA8',
  blueTint: '#E8EEF9',
  red: '#D2232A',
  redTint: '#FCE9EA',
  bg: '#EEF2F9',
  ink: '#1B2541',
  muted: '#5B6478',
};

export const antdTheme = {
  token: {
    colorPrimary: BRAND.blue,
    colorInfo: BRAND.blue,
    colorLink: BRAND.blue,
    colorSuccess: '#2E9D5B',
    colorWarning: '#DD8A16',
    colorError: '#D9363E',
    colorTextBase: '#1B2541',
    borderRadius: 10,
    borderRadiusLG: 16,
    borderRadiusSM: 8,
    controlHeight: 38,
    fontSize: 14,
    fontFamily: '"Source Sans 3", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    colorBorderSecondary: '#E6EAF2',
    wireframe: false,
  },
  components: {
    Layout: { headerBg: BRAND.navy900, headerHeight: 64, bodyBg: BRAND.bg, siderBg: '#FFFFFF' },
    Menu: { itemBorderRadius: 10, itemHeight: 42, itemMarginInline: 10, itemMarginBlock: 3, iconSize: 16, groupTitleFontSize: 11 },
    Card: { borderRadiusLG: 16, paddingLG: 20, headerFontSize: 15, headerHeight: 50 },
    Button: { borderRadius: 10, controlHeight: 38, fontWeight: 600, primaryShadow: 'none', defaultShadow: 'none' },
    Table: { headerBg: '#F7F9FC', headerColor: '#5B6478', borderColor: '#EDF0F5', cellPaddingBlock: 12, headerSplitColor: 'transparent' },
    Statistic: { contentFontSize: 26 },
    Input: { borderRadius: 10, controlHeight: 38 },
    Select: { borderRadius: 10, controlHeight: 38 },
    Segmented: { borderRadius: 10 },
    Tabs: { titleFontSize: 14 },
  },
};
