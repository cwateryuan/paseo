import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

interface ManifestEntry {
  $: Record<string, string>;
}

async function resolveAndroidConfig(env: Partial<NodeJS.ProcessEnv>) {
  // Run the real CLI so config evaluation sees the build's environment, outside Vitest's env proxy.
  const { stdout } = await execFileAsync(
    process.execPath,
    [require.resolve("expo/bin/cli"), "config", "--type", "introspect", "--json"],
    {
      cwd: __dirname,
      env: { ...process.env, ...env },
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
    },
  );
  const config = JSON.parse(stdout);
  return { config, manifest: config._internal.modResults.android.manifest.manifest };
}

describe("Android app config", () => {
  it.each([
    ["Google Play", "0"],
    ["F-Droid", "1"],
  ])(
    "%s build installs on devices without a camera",
    async (_build, fdroidFlag) => {
      const { manifest } = await resolveAndroidConfig({ PASEO_FDROID_BUILD: fdroidFlag });
      const permissions = (manifest["uses-permission"] ?? []).map(
        (entry: ManifestEntry) => entry.$["android:name"],
      );
      const features = (manifest["uses-feature"] ?? []).map((entry: ManifestEntry) => entry.$);

      expect(permissions).toContain("android.permission.CAMERA");
      expect(features).toEqual(
        expect.arrayContaining([
          { "android:name": "android.hardware.camera", "android:required": "false" },
          { "android:name": "android.hardware.camera.autofocus", "android:required": "false" },
        ]),
      );
    },
    30_000,
  );

  it.each([
    ["tablet", "Paseo 平板版", "sh.paseo.tablet", "unspecified", true],
    ["production", "Paseo", "sh.paseo", "portrait", false],
    ["development", "Paseo Debug", "sh.paseo.debug", "portrait", false],
  ])(
    "%s build declares its package, rotation and immersive display",
    async (variant, name, packageId, orientation, immersive) => {
      const { config, manifest } = await resolveAndroidConfig({ APP_VARIANT: variant });
      const activity = manifest.application[0].activity.find(
        (entry: ManifestEntry) => entry.$["android:name"] === ".MainActivity",
      );

      expect(config.android.package).toBe(packageId);
      expect(activity.$["android:screenOrientation"]).toBe(orientation);
      expect(config.extra.tabletFullscreen).toBe(immersive);
      expect(config.android.edgeToEdgeEnabled).toBe(true);
      expect(config.android.softwareKeyboardLayoutMode).toBe("resize");
      expect(config.name).toBe(name);
    },
    30_000,
  );
});
