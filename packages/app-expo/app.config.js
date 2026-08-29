const { getAppVariantConfig } = require("./scripts/app-variant");

const variant = getAppVariantConfig();

module.exports = {
  expo: {
    owner: "nyansippys-team",
    name: variant.name,
    slug: "readany",
    version: "1.3.6",
    orientation: "portrait",
    icon: "./assets/icon.png",
    userInterfaceStyle: "automatic",
    newArchEnabled: true,
    splash: {
      image: "./assets/splash-icon.png",
      resizeMode: "contain",
      backgroundColor: "#05042B",
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: variant.bundleIdentifier,
      buildNumber: "2",
      infoPlist: {
        UIBackgroundModes: ["audio"],
        NSCameraUsageDescription:
          "ReadAny uses the camera to scan sync and configuration QR codes.",
        NSLocalNetworkUsageDescription:
          "ReadAny uses the local network to connect to sync devices and the development server while debugging.",
        // WebDAV endpoints are configured by the user and can be plain HTTP,
        // including bare IP addresses. ATS domain exceptions cannot cover an
        // arbitrary runtime host, so iOS must allow these requests globally.
        // ReadAny only connects to the URL explicitly entered by the user.
        NSAppTransportSecurity: {
          NSAllowsArbitraryLoads: true,
        },
        ITSAppUsesNonExemptEncryption: false,
      },
    },
    android: {
      adaptiveIcon: {
        foregroundImage: "./assets/adaptive-icon.png",
        backgroundColor: "#05042B",
      },
      softwareKeyboardLayoutMode: "resize",
      package: variant.androidPackage,
      permissions: [
        "android.permission.CAMERA",
        "android.permission.RECORD_AUDIO",
        "android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK",
        "android.permission.MODIFY_AUDIO_SETTINGS",
      ],
    },
    plugins: [
      [
        "expo-dev-client",
        {
          launchMode: "launcher",
        },
      ],
      [
        "expo-av",
        {
          microphonePermission: false,
        },
      ],
      [
        "expo-build-properties",
        {
          android: {
            enableProguardInReleaseBuilds: true,
            enableShrinkResourcesInReleaseBuilds: true,
            enableMinifyInReleaseBuilds: true,
            usesCleartextTraffic: true,
          },
        },
      ],
      "./plugins/withGradleMemory",
      "expo-font",
      [
        "expo-image-picker",
        {
          photosPermission: "ReadAny uses your photo library to choose custom book covers.",
        },
      ],
      "expo-secure-store",
      "expo-sqlite",
      "expo-asset",
      "./plugins/withOnnxruntimePackage",
      "onnxruntime-react-native",
      "./plugins/withVolumeKeyPaging",
      [
        "expo-camera",
        {
          cameraPermission: "Allow ReadAny to use your camera to scan sync QR codes.",
        },
      ],
    ],
    scheme: variant.scheme,
    extra: {
      appVariant: variant.key,
      eas: {
        projectId: "093ea8b0-a848-4341-b7e1-7dcd711b540e",
      },
    },
  },
};
