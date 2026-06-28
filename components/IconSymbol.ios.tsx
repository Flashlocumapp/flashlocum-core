import { SymbolView, SymbolViewProps, SymbolWeight } from "expo-symbols";
import { StyleProp, ViewStyle } from "react-native";

export function IconSymbol({
  ios_icon_name,
  android_material_icon_name,
  size = 24,
  color,
  style,
  weight = "regular",
  onPress,
  onClick,
  onMouseOver,
  onMouseLeave,
  testID,
  accessibilityLabel,
}: {
  ios_icon_name: SymbolViewProps["name"];
  android_material_icon_name: string;
  size?: number;
  color: string;
  style?: StyleProp<ViewStyle>;
  weight?: SymbolWeight;
  onPress?: (() => void) | undefined;
  onClick?: (() => void) | undefined;
  onMouseOver?: (() => void) | undefined;
  onMouseLeave?: (() => void) | undefined;
  testID?: string | undefined;
  accessibilityLabel?: string | undefined;
}) {
  return (
    <SymbolView
      onPress={onPress}
      onClick={onClick}
      onMouseOver={onMouseOver}
      onMouseLeave={onMouseLeave}
      testID={testID}
      accessibilityLabel={accessibilityLabel}
      weight={weight}
      tintColor={color}
      resizeMode="scaleAspectFit"
      name={ios_icon_name}
      style={[
        {
          width: size,
          height: size,
        },
        style,
      ]}
    />
  );
}
