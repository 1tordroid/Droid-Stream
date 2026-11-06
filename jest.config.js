module.exports = {
  preset: '@react-native/jest-preset',
  setupFiles: ['./node_modules/react-native-gesture-handler/jestSetup.js', '<rootDir>/__mocks__/expoGlobals.js'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native(-[a-z0-9-]+)?|@[a-z0-9.-]+/react-native(-[a-z0-9-]+)?|@react-native(-community|-tvos)?|expo(-[a-z-]+)?|@expo(-google-fonts)?/[a-z-]+|@react-navigation/[a-z-]+|nativewind|@dr\\.pogodin)/)',
  ],
  moduleNameMapper: {
    '^expo-file-system(/legacy)?$': '<rootDir>/__mocks__/expoFileSystem.js',
    '^@expo/vector-icons/[A-Za-z]+$': '<rootDir>/__mocks__/expoVectorIcon.js',
    '\\.css$': '<rootDir>/__mocks__/styleMock.js',
    '\\.(ttf|otf)$': '<rootDir>/__mocks__/styleMock.js',
    '^@expo/vector-icons$': '<rootDir>/__mocks__/expoVectorIcon.js',
    '^@dr\\.pogodin/react-native-fs$': '<rootDir>/__mocks__/@dr.pogodin/react-native-fs.js',
    '^@expo/ui/jetpack-compose$':
      '<rootDir>/__mocks__/expo-ui-jetpack-compose.js',
    '^@expo/ui/jetpack-compose/modifiers$':
      '<rootDir>/__mocks__/expo-ui-jetpack-compose-modifiers.js',
  },
};
