import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Image,
  Animated,
  StyleSheet,
  StatusBar,
  ImageSourcePropType,
} from "react-native";
import { router } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { ensureAuthReady } from "../utils/authReady";

const LOGO_SOURCE = require("../assets/images/375e6cd3-6f61-434d-aff1-25898cb950c5.jpeg") as number;

const PHRASES = ["Let's request coverage.", "Let's respond to shifts.", "Let's cover & earn."];

function resolveImageSource(
  source: string | number | ImageSourcePropType | undefined,
): ImageSourcePropType {
  if (!source) return { uri: "" };
  if (typeof source === "string") return { uri: source };
  return source as ImageSourcePropType;
}

export default function SplashEntry() {
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const logoScale = useRef(new Animated.Value(0.85)).current;
  const wordmarkOpacity = useRef(new Animated.Value(0)).current;
  const phraseOpacity = useRef(new Animated.Value(0)).current;
  const cursorOpacity = useRef(new Animated.Value(1)).current;

  const [phraseText, setPhraseText] = useState("");

  useEffect(() => {
    console.log("[FlashLocum] SplashEntry: mounted, hiding native splash");
    SplashScreen.hideAsync().catch(() => {});

    let cancelled = false;

    // Blink cursor loop
    const blinkCursor = () => {
      Animated.loop(
        Animated.sequence([
          Animated.timing(cursorOpacity, {
            toValue: 0,
            duration: 500,
            useNativeDriver: true,
          }),
          Animated.timing(cursorOpacity, {
            toValue: 1,
            duration: 500,
            useNativeDriver: true,
          }),
        ]),
      ).start();
    };

    const typePhrase = (phrase: string): Promise<void> => {
      return new Promise((resolve) => {
        let i = 0;
        const interval = setInterval(() => {
          if (cancelled) {
            clearInterval(interval);
            resolve();
            return;
          }
          i++;
          setPhraseText(phrase.slice(0, i));
          if (i >= phrase.length) {
            clearInterval(interval);
            resolve();
          }
        }, 60);
      });
    };

    const fadeOutPhrase = (): Promise<void> => {
      return new Promise((resolve) => {
        Animated.timing(phraseOpacity, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }).start(() => {
          setPhraseText("");
          resolve();
        });
      });
    };

    const fadeInPhrase = (): Promise<void> => {
      return new Promise((resolve) => {
        Animated.timing(phraseOpacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }).start(() => resolve());
      });
    };

    const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

    const runSequence = async () => {
      // Step 1: Logo fade in + scale
      await new Promise<void>((resolve) => {
        Animated.parallel([
          Animated.timing(logoOpacity, { toValue: 1, duration: 600, useNativeDriver: true }),
          Animated.timing(logoScale, { toValue: 1.0, duration: 600, useNativeDriver: true }),
        ]).start(() => resolve());
      });

      if (cancelled) return;

      // Step 2: Wordmark fade in (300ms delay)
      await wait(300);
      if (cancelled) return;

      await new Promise<void>((resolve) => {
        Animated.timing(wordmarkOpacity, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }).start(() => resolve());
      });

      if (cancelled) return;

      // Step 3: Hold 800ms then start phrases
      await wait(800);
      if (cancelled) return;

      blinkCursor();

      // Step 4: Type each phrase
      for (const phrase of PHRASES) {
        if (cancelled) return;
        await fadeInPhrase();
        if (cancelled) return;
        await typePhrase(phrase);
        if (cancelled) return;
        await wait(1200);
        if (cancelled) return;
        await fadeOutPhrase();
        if (cancelled) return;
        await wait(200);
      }

      if (cancelled) return;

      // Step 5: Check session and navigate
      console.log("[FlashLocum] SplashEntry: checking auth session");
      const snap = await ensureAuthReady();
      if (cancelled) return;

      if (snap.session && snap.user?.email_confirmed_at) {
        console.log("[FlashLocum] SplashEntry: session found, navigating to tabs");
        router.replace("/(tabs)");
      } else {
        console.log("[FlashLocum] SplashEntry: no session, navigating to role selection");
        router.replace("/role");
      }
    };

    runSequence();

    return () => {
      cancelled = true;
    };
    // Animated values from useRef are stable — intentionally omitted from deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#000000" />
      <Animated.View
        style={[styles.logoContainer, { opacity: logoOpacity, transform: [{ scale: logoScale }] }]}
      >
        <Image source={resolveImageSource(LOGO_SOURCE)} style={styles.logoImage} />
      </Animated.View>

      <Animated.Text style={[styles.wordmark, { opacity: wordmarkOpacity }]}>
        FlashLocum
      </Animated.Text>

      <View style={styles.phraseRow}>
        <Animated.Text style={[styles.phraseText, { opacity: phraseOpacity }]}>
          {phraseText}
        </Animated.Text>
        <Animated.Text style={[styles.cursor, { opacity: cursorOpacity }]}>|</Animated.Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000000",
    alignItems: "center",
    justifyContent: "center",
  },
  logoContainer: {
    width: 160,
    height: 160,
    borderRadius: 36,
    overflow: "hidden",
  },
  logoImage: {
    width: 160,
    height: 160,
    resizeMode: "cover",
  },
  wordmark: {
    fontSize: 32,
    fontWeight: "700",
    color: "#FFFFFF",
    letterSpacing: 0.5,
    marginTop: 20,
  },
  phraseRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 48,
    minHeight: 28,
  },
  phraseText: {
    fontSize: 17,
    color: "rgba(255,255,255,0.7)",
  },
  cursor: {
    fontSize: 17,
    color: "rgba(255,255,255,0.7)",
    marginLeft: 1,
  },
});
