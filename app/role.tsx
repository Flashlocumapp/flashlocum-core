import React, { useEffect, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  StatusBar,
  Image,
  ImageSourcePropType,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";

const LOGO_SOURCE = require("../assets/images/375e6cd3-6f61-434d-aff1-25898cb950c5.jpeg") as number;

function resolveImageSource(
  source: string | number | ImageSourcePropType | undefined,
): ImageSourcePropType {
  if (!source) return { uri: "" };
  if (typeof source === "string") return { uri: source };
  return source as ImageSourcePropType;
}

const CalendarIcon = () => (
  <View style={iconStyles.container}>
    <View style={iconStyles.calendarTop} />
    <View style={iconStyles.calendarBody}>
      <View style={iconStyles.calendarGrid}>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <View key={i} style={iconStyles.calendarDot} />
        ))}
      </View>
    </View>
    <View style={iconStyles.calendarPin1} />
    <View style={iconStyles.calendarPin2} />
  </View>
);

const StethoscopeIcon = () => (
  <View style={iconStyles.container}>
    <View style={iconStyles.stethCircle} />
    <View style={iconStyles.stethLine} />
    <View style={iconStyles.stethEnd} />
  </View>
);

const iconStyles = StyleSheet.create({
  container: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  calendarTop: {
    width: 28,
    height: 8,
    backgroundColor: "rgba(255,255,255,0.9)",
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
    position: "absolute",
    top: 2,
  },
  calendarBody: {
    width: 28,
    height: 20,
    backgroundColor: "rgba(255,255,255,0.15)",
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.7)",
    borderBottomLeftRadius: 4,
    borderBottomRightRadius: 4,
    position: "absolute",
    top: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  calendarGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    width: 20,
    gap: 3,
  },
  calendarDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.7)",
  },
  calendarPin1: {
    width: 3,
    height: 7,
    backgroundColor: "rgba(255,255,255,0.9)",
    borderRadius: 2,
    position: "absolute",
    top: 0,
    left: 9,
  },
  calendarPin2: {
    width: 3,
    height: 7,
    backgroundColor: "rgba(255,255,255,0.9)",
    borderRadius: 2,
    position: "absolute",
    top: 0,
    right: 9,
  },
  stethCircle: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2.5,
    borderColor: "rgba(255,255,255,0.9)",
    position: "absolute",
    top: 2,
    left: 2,
  },
  stethLine: {
    width: 2.5,
    height: 18,
    backgroundColor: "rgba(255,255,255,0.9)",
    borderRadius: 2,
    position: "absolute",
    top: 10,
    right: 10,
    transform: [{ rotate: "20deg" }],
  },
  stethEnd: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "rgba(255,255,255,0.9)",
    position: "absolute",
    bottom: 2,
    right: 6,
  },
});

const ChevronRight = () => (
  <View style={chevronStyles.container}>
    <View style={chevronStyles.line1} />
    <View style={chevronStyles.line2} />
  </View>
);

const chevronStyles = StyleSheet.create({
  container: {
    width: 20,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  line1: {
    width: 8,
    height: 2,
    backgroundColor: "rgba(255,255,255,0.7)",
    borderRadius: 1,
    transform: [{ rotate: "45deg" }, { translateY: -3 }],
    position: "absolute",
  },
  line2: {
    width: 8,
    height: 2,
    backgroundColor: "rgba(255,255,255,0.7)",
    borderRadius: 1,
    transform: [{ rotate: "-45deg" }, { translateY: 3 }],
    position: "absolute",
  },
});

export default function RoleScreen() {
  const card1Opacity = useRef(new Animated.Value(0)).current;
  const card1TranslateY = useRef(new Animated.Value(20)).current;
  const card2Opacity = useRef(new Animated.Value(0)).current;
  const card2TranslateY = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    console.log("[FlashLocum] RoleScreen: mounted");
    Animated.stagger(100, [
      Animated.parallel([
        Animated.timing(card1Opacity, {
          toValue: 1,
          duration: 400,
          useNativeDriver: true,
        }),
        Animated.timing(card1TranslateY, {
          toValue: 0,
          duration: 400,
          useNativeDriver: true,
        }),
      ]),
      Animated.parallel([
        Animated.timing(card2Opacity, {
          toValue: 1,
          duration: 400,
          useNativeDriver: true,
        }),
        Animated.timing(card2TranslateY, {
          toValue: 0,
          duration: 400,
          useNativeDriver: true,
        }),
      ]),
    ]).start();
    // Animated values from useRef are stable — intentionally omitted from deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRequestPress = () => {
    console.log("[FlashLocum] RoleScreen: selected Request Coverage");
    router.push("/auth/request");
  };

  const handleCoverPress = () => {
    console.log("[FlashLocum] RoleScreen: selected Cover & Earn");
    router.push("/auth/cover");
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="#0A0A0A" />

      {/* Header */}
      <View style={styles.header}>
        <Image source={resolveImageSource(LOGO_SOURCE)} style={styles.logoSmall} />
        <Text style={styles.logoText}>FlashLocum</Text>
      </View>

      {/* Cards */}
      <View style={styles.cardsContainer}>
        <Animated.View
          style={[
            styles.cardWrapper,
            { opacity: card1Opacity, transform: [{ translateY: card1TranslateY }] },
          ]}
        >
          <TouchableOpacity
            style={[styles.card, styles.cardRequest]}
            onPress={handleRequestPress}
            activeOpacity={0.85}
          >
            <View style={styles.cardContent}>
              <CalendarIcon />
              <View style={styles.cardText}>
                <Text style={styles.cardTitle}>Request Coverage</Text>
                <Text style={styles.cardSubtitle}>
                  Post shifts and find qualified locum doctors fast.
                </Text>
              </View>
            </View>
            <ChevronRight />
          </TouchableOpacity>
        </Animated.View>

        <Animated.View
          style={[
            styles.cardWrapper,
            { opacity: card2Opacity, transform: [{ translateY: card2TranslateY }] },
          ]}
        >
          <TouchableOpacity
            style={[styles.card, styles.cardCover]}
            onPress={handleCoverPress}
            activeOpacity={0.85}
          >
            <View style={styles.cardContent}>
              <StethoscopeIcon />
              <View style={styles.cardText}>
                <Text style={styles.cardTitle}>Cover & Earn</Text>
                <Text style={styles.cardSubtitle}>
                  Browse open shifts and earn as a locum doctor.
                </Text>
              </View>
            </View>
            <ChevronRight />
          </TouchableOpacity>
        </Animated.View>
      </View>

      {/* Footer */}
      <View style={styles.footer}>
        <Text style={styles.footerText}>Terms of Service</Text>
        <Text style={styles.footerDot}> · </Text>
        <Text style={styles.footerText}>Privacy Policy</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#0A0A0A",
  },
  header: {
    alignItems: "center",
    paddingTop: 60,
    paddingBottom: 20,
  },
  logoSmall: {
    width: 44,
    height: 44,
    borderRadius: 10,
  },
  logoText: {
    fontSize: 18,
    fontWeight: "700",
    color: "#FFFFFF",
    marginTop: 8,
    letterSpacing: 0.3,
  },
  cardsContainer: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 20,
    gap: 12,
  },
  cardWrapper: {
    flex: 1,
    maxHeight: 180,
  },
  card: {
    flex: 1,
    borderRadius: 20,
    padding: 24,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  cardRequest: {
    backgroundColor: "#0D1B4B",
  },
  cardCover: {
    backgroundColor: "#0A2463",
  },
  cardContent: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    gap: 16,
  },
  cardText: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: "#FFFFFF",
    marginBottom: 6,
  },
  cardSubtitle: {
    fontSize: 14,
    color: "rgba(255,255,255,0.7)",
    lineHeight: 20,
  },
  footer: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    paddingBottom: 20,
    paddingTop: 12,
  },
  footerText: {
    fontSize: 12,
    color: "#636366",
  },
  footerDot: {
    fontSize: 12,
    color: "#636366",
  },
});
