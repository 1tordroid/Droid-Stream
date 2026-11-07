import {describe, expect, it} from '@jest/globals';

const {addAppGradle, addClasspath} = require('../plugins/with-ytdlp');

const ROOT = `buildscript {
  repositories {
    google()
  }
  dependencies {
    classpath('com.android.tools.build:gradle')
  }
}
`;

const APP = `apply plugin: "com.android.application"
apply plugin: "org.jetbrains.kotlin.android"

dependencies {
    implementation("com.facebook.react:react-android")
}
`;

describe('with-ytdlp plugin', () => {
  it('adds the Chaquopy Gradle plugin once', () => {
    const once = addClasspath(ROOT);
    expect(once).toContain("classpath('com.chaquo.python:gradle:17.2.0')");
    expect(addClasspath(once)).toBe(once);
    expect(addClasspath(once.replace('17.2.0', '16.0.0'))).toBe(once);
  });

  it('applies Chaquopy after the Android plugin, with Python 3.11 and the JS sandbox', () => {
    const once = addAppGradle(APP);
    expect(once.indexOf('apply plugin: "com.chaquo.python"')).toBeGreaterThan(once.indexOf('com.android.application'));
    expect(once.indexOf('apply plugin: "com.chaquo.python"')).toBeLessThan(once.indexOf('org.jetbrains.kotlin.android'));
    expect(once).toContain('version = "3.11"');
    expect(once).toContain("implementation 'androidx.javascriptengine:javascriptengine:1.1.1'");
    expect(addAppGradle(once)).toBe(once);
    expect(addAppGradle(once.replace('javascriptengine:1.1.1', 'javascriptengine:1.0.0'))).toBe(once);
  });
});
