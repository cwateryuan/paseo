import { spawnSync, execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

const target = process.argv[2] ?? "universal";
const architectures = {
  universal: "armeabi-v7a,arm64-v8a,x86,x86_64",
  arm64: "arm64-v8a",
}[target];
if (!architectures) {
  throw new Error(`Unknown APK target: ${target}. Use universal or arm64.`);
}
const variant = process.argv[3] ?? "production";
if (variant !== "production" && variant !== "tablet") {
  throw new Error(`Unknown APK variant: ${variant}. Use production or tablet.`);
}
const isWindows = process.platform === "win32";

const root = fileURLToPath(new URL("..", import.meta.url));
const app = path.join(root, "packages/app");
const env = {
  ...process.env,
  APP_VARIANT: variant,
  PASEO_WATCHDOG_BUILD: "1",
  PASEO_DIAGNOSTIC_BUILD_TIME: new Date().toISOString(),
  PASEO_DIAGNOSTIC_REVISION:
    execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root, encoding: "utf8" }).trim() +
    (execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim()
      ? "-dirty"
      : ""),
};
function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    stdio: "inherit",
    shell: isWindows,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
run("npm", ["run", "build:app-deps"], root);
run("npx", ["expo", "prebuild", "--platform", "android", "--no-install"], app);
// Gradle does not track Metro's environment flags. Always regenerate the JS artifact
// so a previous ordinary release cannot silently bypass the profiling renderer.
rmSync(path.join(app, "android/app/build/generated/assets"), { recursive: true, force: true });
run(
  isWindows ? "gradlew.bat" : "./gradlew",
  [
    "assembleRelease",
    "--no-daemon",
    "--max-workers=1",
    "-Dorg.gradle.parallel=false",
    `-PreactNativeArchitectures=${architectures}`,
  ],
  path.join(app, "android"),
);
const artifactName = variant === "tablet" ? `paseo-tablet-${target}` : `paseo-dogfood-${target}`;
const destination = path.join(root, `artifacts/${artifactName}.apk`);
mkdirSync(path.dirname(destination), { recursive: true });
const unsignedArtifact = path.join(app, "android/app/build/outputs/apk/release/app-release.apk");
if (variant === "tablet") {
  const sdk = env.ANDROID_HOME ?? env.ANDROID_SDK_ROOT;
  if (!sdk || !env.JAVA_HOME) throw new Error("Tablet signing needs ANDROID_HOME and JAVA_HOME.");
  const signingDirectory = path.join(root, ".dev/android-signing");
  const keystore = path.join(signingDirectory, "tablet-release.p12");
  const passwordFile = path.join(signingDirectory, "tablet-release.password");
  mkdirSync(signingDirectory, { recursive: true });
  if (!existsSync(keystore)) {
    writeFileSync(passwordFile, randomBytes(32).toString("hex"), { mode: 0o600 });
    run(
      path.join(env.JAVA_HOME, "bin", isWindows ? "keytool.exe" : "keytool"),
      [
        "-genkeypair",
        "-storetype",
        "PKCS12",
        "-keystore",
        keystore,
        "-storepass:file",
        passwordFile,
        "-keypass:file",
        passwordFile,
        "-alias",
        "paseo-tablet",
        "-keyalg",
        "RSA",
        "-keysize",
        "3072",
        "-validity",
        "10000",
        "-dname",
        "CN=PaseoTabletLocal",
      ],
      root,
    );
  }
  const buildTools = readdirSync(path.join(sdk, "build-tools"))
    .filter((version) => /^\d+\.\d+\.\d+$/.test(version))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .at(-1);
  if (!buildTools) throw new Error("No Android SDK build-tools available for APK signing.");
  run(
    path.join(sdk, "build-tools", buildTools, isWindows ? "apksigner.bat" : "apksigner"),
    [
      "sign",
      "--ks",
      keystore,
      "--ks-key-alias",
      "paseo-tablet",
      "--ks-pass",
      `file:${passwordFile}`,
      "--out",
      destination,
      unsignedArtifact,
    ],
    root,
  );
} else {
  copyFileSync(unsignedArtifact, destination);
}
console.log(`\nDiagnostic release APK: ${destination}\nLogs: Downloads/Paseo diagnostics\n`);
