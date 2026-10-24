import { SystemBars } from "react-native-edge-to-edge";
import { withUnistyles } from "react-native-unistyles";
import type { Theme } from "@/styles/theme";
import { isTabletFullscreenBuild } from "@/constants/build-profile";

function ThemeSystemBars({ colorScheme }: Pick<Theme, "colorScheme">) {
  return (
    <SystemBars
      hidden={isTabletFullscreenBuild}
      style={colorScheme === "light" ? "dark" : "light"}
    />
  );
}

export const AppearanceSystemBars = withUnistyles(ThemeSystemBars, (theme) => ({
  colorScheme: theme.colorScheme,
}));
