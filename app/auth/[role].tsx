import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  StatusBar,
  Linking,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { supabase } from "../../utils/supabase";
import { fetchMyProfile } from "../../utils/profileRemote";
import { adoptVerifiedSession, ensureAuthReady, subscribeAuthState } from "../../utils/authReady";
import { setRole, type Role } from "../../utils/role";

type View = "form" | "verify" | "forgot" | "forgot-code" | "forgot-new-password" | "forgot-done";

const AUTH_DEBUG_PREFIX = "[FlashLocum auth debug]";

function maskEmail(value: string) {
  const [namePart, domainPart] = value.trim().toLowerCase().split("@");
  if (!namePart || !domainPart) return "unknown";
  return `${namePart.slice(0, 2)}***@${domainPart}`;
}

function logAuthDebug(event: string, details: Record<string, unknown> = {}) {
  console.info(AUTH_DEBUG_PREFIX, event, {
    at: new Date().toISOString(),
    ...details,
  });
}

// Eye icon (show password)
const EyeIcon = () => (
  <View style={eyeStyles.container}>
    <View style={eyeStyles.outer} />
    <View style={eyeStyles.inner} />
  </View>
);

// Eye-off icon (hide password)
const EyeOffIcon = () => (
  <View style={eyeStyles.container}>
    <View style={eyeStyles.outer} />
    <View style={eyeStyles.slash} />
  </View>
);

const eyeStyles = StyleSheet.create({
  container: {
    width: 20,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  outer: {
    width: 18,
    height: 12,
    borderRadius: 6,
    borderWidth: 1.6,
    borderColor: "#98989D",
  },
  inner: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#98989D",
    position: "absolute",
  },
  slash: {
    width: 18,
    height: 1.6,
    backgroundColor: "#98989D",
    borderRadius: 1,
    position: "absolute",
    transform: [{ rotate: "-45deg" }],
  },
});

// Back chevron
const BackChevron = () => (
  <View style={backStyles.container}>
    <View style={backStyles.line1} />
    <View style={backStyles.line2} />
  </View>
);

const backStyles = StyleSheet.create({
  container: {
    width: 16,
    height: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  line1: {
    width: 8,
    height: 2,
    backgroundColor: "#FFFFFF",
    borderRadius: 1,
    transform: [{ rotate: "45deg" }, { translateY: -3 }],
    position: "absolute",
  },
  line2: {
    width: 8,
    height: 2,
    backgroundColor: "#FFFFFF",
    borderRadius: 1,
    transform: [{ rotate: "-45deg" }, { translateY: 3 }],
    position: "absolute",
  },
});

export default function AuthScreen() {
  const { role } = useLocalSearchParams<{ role: string }>();
  const [mode, setMode] = useState<"signup" | "login">("signup");
  const [view, setView] = useState<View>("form");
  const [showPw, setShowPw] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const normalizedRole: Role = role === "cover" ? "cover" : "request";
  const roleLabel = normalizedRole === "cover" ? "Cover & Earn" : "Request Coverage";

  const proceed = useCallback(async () => {
    console.log("[FlashLocum] AuthScreen: proceed() called for role:", normalizedRole);
    let profile = await fetchMyProfile();
    if (!profile) {
      await new Promise((r) => setTimeout(r, 250));
      profile = await fetchMyProfile();
    }

    const onboardedThis =
      normalizedRole === "cover" ? !!profile?.onboarded_cover_at : !!profile?.onboarded_request_at;
    const onboardedOther =
      normalizedRole === "cover" ? !!profile?.onboarded_request_at : !!profile?.onboarded_cover_at;

    if (onboardedThis) {
      console.log("[FlashLocum] AuthScreen: user onboarded for this role, navigating to tabs");
      await setRole(normalizedRole);
      router.replace("/(tabs)");
      return;
    }
    if (onboardedOther) {
      console.log("[FlashLocum] AuthScreen: user onboarded for OTHER role, signing out");
      await supabase.auth.signOut();
      const otherLabel = normalizedRole === "cover" ? "Request Coverage" : "Cover & Earn";
      setError(
        `This account is not registered under ${roleLabel}. It belongs to ${otherLabel}. Please create an account.`,
      );
      setMode("signup");
      setView("form");
      setPassword("");
      return;
    }

    console.log("[FlashLocum] AuthScreen: no onboarding yet, navigating to onboarding");
    await setRole(normalizedRole);
    router.push(`/onboarding/${normalizedRole}`);
  }, [normalizedRole, roleLabel]);

  useEffect(() => {
    console.log("[FlashLocum] AuthScreen: mounted for role:", normalizedRole);
    let cancelled = false;

    const offAuth = subscribeAuthState(({ event, session }) => {
      logAuthDebug("auth-state-change", {
        event,
        hasSession: Boolean(session),
        emailVerified: Boolean(session?.user.email_confirmed_at),
      });
    });

    (async () => {
      const { session } = await ensureAuthReady();
      if (!session?.user.email_confirmed_at) return;
      if (cancelled) return;

      const profile = await fetchMyProfile();
      if (cancelled) return;
      const onboardedThis =
        normalizedRole === "cover"
          ? !!profile?.onboarded_cover_at
          : !!profile?.onboarded_request_at;
      if (onboardedThis) {
        await proceed();
      }
    })();

    return () => {
      cancelled = true;
      offAuth();
    };
  }, [proceed, normalizedRole]);

  const handleSubmit = async () => {
    console.log("[FlashLocum] AuthScreen: handleSubmit, mode:", mode, "email:", maskEmail(email));
    if (busy) return;
    setError(null);
    setInfo(null);

    if (!email || !password) {
      setError("Enter your email and password.");
      return;
    }
    if (mode === "signup" && password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }

    setBusy(true);
    try {
      if (mode === "signup") {
        logAuthDebug("signup:otp-generation-requested", {
          email: maskEmail(email),
          role: normalizedRole,
          flow: "verifyOtp:type=signup",
          emailRedirectTo: `flashlocum://auth/${normalizedRole}`,
        });
        const { data, error: err } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `flashlocum://auth/${normalizedRole}`,
            data: { full_name: name || undefined, role: normalizedRole },
          },
        });
        if (err) {
          logAuthDebug("signup:email-send-failed", {
            email: maskEmail(email),
            message: err.message,
            status: err.status,
          });
          throw err;
        }
        logAuthDebug("signup:email-send-accepted", {
          email: maskEmail(email),
          userId: data.user?.id,
          hasSession: Boolean(data.session),
          emailVerified: Boolean(data.user?.email_confirmed_at),
          identities: data.user?.identities?.length ?? 0,
        });
        if (!data.session && data.user && (data.user.identities?.length ?? 0) === 0) {
          logAuthDebug("signup:existing-account-no-otp-sent", {
            email: maskEmail(email),
            reason: "auth-service-returned-existing-user-without-new-identity",
          });
          setMode("login");
          setError(
            "This email is already registered. Sign in instead, or use Forgot password if needed.",
          );
          return;
        }
        if (data.session?.user.email_confirmed_at) {
          adoptVerifiedSession(data.session);
          await proceed();
          return;
        }
        setCode("");
        setView("verify");
      } else {
        const { data, error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err) {
          console.log("[FlashLocum] AuthScreen: sign in failed:", err.message);
          if (/confirm/i.test(err.message)) {
            setCode("");
            setView("verify");
            return;
          }
          throw err;
        }
        if (!data.session?.user.email_confirmed_at) {
          setCode("");
          setView("verify");
          return;
        }
        console.log("[FlashLocum] AuthScreen: sign in succeeded");
        adoptVerifiedSession(data.session);
        await proceed();
      }
    } catch (err) {
      setError((err as Error).message || "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const handleVerify = async () => {
    console.log("[FlashLocum] AuthScreen: handleVerify, code length:", code.trim().length);
    if (busy) return;
    setError(null);
    setInfo(null);
    const token = code.trim();
    if (token.length < 6) {
      setError("Enter the 6-digit code from your email.");
      return;
    }
    setBusy(true);
    try {
      const { data, error: err } = await supabase.auth.verifyOtp({
        email,
        token,
        type: "signup",
      });
      if (err) {
        logAuthDebug("verify-otp:failed", {
          email: maskEmail(email),
          tokenLength: token.length,
          message: err.message,
          status: err.status,
        });
        throw err;
      }
      logAuthDebug("verify-otp:succeeded", {
        email: maskEmail(email),
        hasSession: Boolean(data.session),
        emailVerified: Boolean(data.user?.email_confirmed_at),
      });
      if (data.session) {
        adoptVerifiedSession(data.session);
        await proceed();
      } else {
        setError("Verification failed. Please try again.");
      }
    } catch (err) {
      setError((err as Error).message || "Invalid or expired code.");
    } finally {
      setBusy(false);
    }
  };

  const handleResend = async () => {
    console.log("[FlashLocum] AuthScreen: handleResend for email:", maskEmail(email));
    if (!email) {
      setError("Enter your email first.");
      return;
    }
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      logAuthDebug("resend:otp-generation-requested", {
        email: maskEmail(email),
        role: normalizedRole,
        flow: "resend:type=signup",
      });
      const { error: err } = await supabase.auth.resend({
        type: "signup",
        email,
        options: { emailRedirectTo: `flashlocum://auth/${normalizedRole}` },
      });
      if (err) {
        logAuthDebug("resend:email-send-failed", {
          email: maskEmail(email),
          message: err.message,
          status: err.status,
        });
        throw err;
      }
      logAuthDebug("resend:email-send-accepted", {
        email: maskEmail(email),
        deliveryResponse: "auth-api-accepted-request",
      });
      setInfo("New code sent. Check your email.");
    } catch (err) {
      setError((err as Error).message || "Could not resend email.");
    } finally {
      setBusy(false);
    }
  };

  const handleForgot = async () => {
    console.log("[FlashLocum] AuthScreen: handleForgot for email:", maskEmail(email));
    if (busy) return;
    if (!email) {
      setError("Enter your email.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { error: err } = await supabase.auth.resetPasswordForEmail(email);
      if (err) throw err;
      console.log("[FlashLocum] AuthScreen: password reset email sent");
      setCode("");
      setInfo(null);
      setView("forgot-code");
    } catch (err) {
      setError((err as Error).message || "Could not send reset code.");
    } finally {
      setBusy(false);
    }
  };

  const handleVerifyResetCode = async () => {
    console.log("[FlashLocum] AuthScreen: handleVerifyResetCode, code length:", code.trim().length);
    if (busy) return;
    setError(null);
    const token = code.trim();
    if (token.length < 6) {
      setError("Enter the 6-digit code from your email.");
      return;
    }
    setBusy(true);
    try {
      const { data, error: err } = await supabase.auth.verifyOtp({
        email,
        token,
        type: "recovery",
      });
      if (err) throw err;
      if (!data.session) {
        setError("Verification failed. Please try again.");
        return;
      }
      console.log("[FlashLocum] AuthScreen: reset code verified");
      adoptVerifiedSession(data.session);
      setNewPassword("");
      setView("forgot-new-password");
    } catch (err) {
      setError((err as Error).message || "Invalid or expired code.");
    } finally {
      setBusy(false);
    }
  };

  const handleResendReset = async () => {
    console.log("[FlashLocum] AuthScreen: handleResendReset for email:", maskEmail(email));
    if (!email) {
      setError("Enter your email first.");
      return;
    }
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const { error: err } = await supabase.auth.resetPasswordForEmail(email);
      if (err) throw err;
      setInfo("New code sent. Check your email.");
    } catch (err) {
      setError((err as Error).message || "Could not resend code.");
    } finally {
      setBusy(false);
    }
  };

  const handleSetNewPassword = async () => {
    console.log("[FlashLocum] AuthScreen: handleSetNewPassword");
    if (busy) return;
    if (newPassword.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const { error: err } = await supabase.auth.updateUser({ password: newPassword });
      if (err) throw err;
      await supabase.auth.signOut();
      console.log("[FlashLocum] AuthScreen: password updated, signed out");
      setNewPassword("");
      setPassword("");
      setView("forgot-done");
    } catch (err) {
      setError((err as Error).message || "Could not update password.");
    } finally {
      setBusy(false);
    }
  };

  const handleBack = () => {
    console.log("[FlashLocum] AuthScreen: back button pressed");
    router.back();
  };

  // ---- Shell header ----
  const renderHeader = () => (
    <View style={styles.header}>
      <TouchableOpacity style={styles.backButton} onPress={handleBack} activeOpacity={0.7}>
        <BackChevron />
      </TouchableOpacity>
      <Text style={styles.roleLabel}>{roleLabel.toUpperCase()}</Text>
      <View style={styles.headerSpacer} />
    </View>
  );

  // ---- Error box ----
  const renderError = (msg: string) => (
    <View style={styles.errorBox}>
      <Text style={styles.errorText}>{msg}</Text>
    </View>
  );

  // ---- Info box ----
  const renderInfo = (msg: string) => (
    <View style={styles.infoBox}>
      <Text style={styles.infoText}>{msg}</Text>
    </View>
  );

  // ---- VERIFY view ----
  if (view === "verify") {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="light-content" backgroundColor="#000000" />
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <ScrollView
            style={styles.flex}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            {renderHeader()}
            <View style={styles.titleSection}>
              <Text style={styles.title}>Enter verification code</Text>
              <Text style={styles.subtitle}>
                {`We've sent a 6-digit code to ${email || "your email"}. Enter it below to verify your account.`}
              </Text>
            </View>
            <View style={styles.form}>
              <TextInput
                style={styles.otpInput}
                keyboardType="number-pad"
                maxLength={6}
                value={code}
                onChangeText={(t) => setCode(t.replace(/\D/g, "").slice(0, 6))}
                placeholder="000000"
                placeholderTextColor="rgba(152,152,157,0.4)"
                textAlign="center"
                autoComplete="one-time-code"
              />
              {info ? renderInfo(info) : null}
              {error ? renderError(error) : null}
              <TouchableOpacity
                style={[styles.primaryButton, (busy || code.length < 6) && styles.buttonDisabled]}
                onPress={handleVerify}
                disabled={busy || code.length < 6}
                activeOpacity={0.85}
              >
                {busy ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.primaryButtonText}>Verify & continue</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.secondaryButton, busy && styles.buttonDisabled]}
                onPress={handleResend}
                disabled={busy}
                activeOpacity={0.85}
              >
                <Text style={styles.secondaryButtonText}>Resend code</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.textLink}
                onPress={() => {
                  console.log("[FlashLocum] AuthScreen: back to sign in from verify");
                  setView("form");
                  setCode("");
                  setError(null);
                }}
              >
                <Text style={styles.textLinkText}>Back to sign in</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // ---- FORGOT view ----
  if (view === "forgot") {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="light-content" backgroundColor="#000000" />
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <ScrollView
            style={styles.flex}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            {renderHeader()}
            <View style={styles.titleSection}>
              <Text style={styles.title}>Reset your password</Text>
              <Text style={styles.subtitle}>Enter your email and we'll send you a reset code.</Text>
            </View>
            <View style={styles.form}>
              <View style={styles.fieldContainer}>
                <Text style={styles.fieldLabel}>Email</Text>
                <TextInput
                  style={styles.input}
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoComplete="email"
                  placeholder="you@example.com"
                  placeholderTextColor="#98989D"
                />
              </View>
              {error ? renderError(error) : null}
              <TouchableOpacity
                style={[styles.primaryButton, busy && styles.buttonDisabled]}
                onPress={handleForgot}
                disabled={busy}
                activeOpacity={0.85}
              >
                {busy ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.primaryButtonText}>Send reset code</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.textLink}
                onPress={() => {
                  console.log("[FlashLocum] AuthScreen: back to sign in from forgot");
                  setView("form");
                  setError(null);
                }}
              >
                <Text style={styles.textLinkText}>Back to sign in</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // ---- FORGOT-CODE view ----
  if (view === "forgot-code") {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="light-content" backgroundColor="#000000" />
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <ScrollView
            style={styles.flex}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            {renderHeader()}
            <View style={styles.titleSection}>
              <Text style={styles.title}>Enter reset code</Text>
              <Text style={styles.subtitle}>
                {`We've sent a 6-digit code to ${email || "your email"}.`}
              </Text>
            </View>
            <View style={styles.form}>
              <TextInput
                style={styles.otpInput}
                keyboardType="number-pad"
                maxLength={6}
                value={code}
                onChangeText={(t) => setCode(t.replace(/\D/g, "").slice(0, 6))}
                placeholder="000000"
                placeholderTextColor="rgba(152,152,157,0.4)"
                textAlign="center"
                autoComplete="one-time-code"
              />
              {info ? renderInfo(info) : null}
              {error ? renderError(error) : null}
              <TouchableOpacity
                style={[styles.primaryButton, (busy || code.length < 6) && styles.buttonDisabled]}
                onPress={handleVerifyResetCode}
                disabled={busy || code.length < 6}
                activeOpacity={0.85}
              >
                {busy ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.primaryButtonText}>Verify code</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.secondaryButton, busy && styles.buttonDisabled]}
                onPress={handleResendReset}
                disabled={busy}
                activeOpacity={0.85}
              >
                <Text style={styles.secondaryButtonText}>Resend code</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // ---- FORGOT-NEW-PASSWORD view ----
  if (view === "forgot-new-password") {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="light-content" backgroundColor="#000000" />
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <ScrollView
            style={styles.flex}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            {renderHeader()}
            <View style={styles.titleSection}>
              <Text style={styles.title}>Choose a new password</Text>
              <Text style={styles.subtitle}>
                Pick a password you haven't used before. Minimum 6 characters.
              </Text>
            </View>
            <View style={styles.form}>
              <View style={styles.fieldContainer}>
                <Text style={styles.fieldLabel}>New password</Text>
                <View style={styles.passwordRow}>
                  <TextInput
                    style={styles.passwordInput}
                    value={newPassword}
                    onChangeText={setNewPassword}
                    secureTextEntry={!showPw}
                    autoComplete="new-password"
                    placeholder="••••••••"
                    placeholderTextColor="#98989D"
                  />
                  <TouchableOpacity
                    style={styles.eyeButton}
                    onPress={() => {
                      console.log("[FlashLocum] AuthScreen: toggle password visibility");
                      setShowPw((v) => !v);
                    }}
                    activeOpacity={0.7}
                  >
                    {showPw ? <EyeOffIcon /> : <EyeIcon />}
                  </TouchableOpacity>
                </View>
              </View>
              {error ? renderError(error) : null}
              <TouchableOpacity
                style={[
                  styles.primaryButton,
                  (busy || newPassword.length < 6) && styles.buttonDisabled,
                ]}
                onPress={handleSetNewPassword}
                disabled={busy || newPassword.length < 6}
                activeOpacity={0.85}
              >
                {busy ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.primaryButtonText}>Update password</Text>
                )}
              </TouchableOpacity>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // ---- FORGOT-DONE view ----
  if (view === "forgot-done") {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="light-content" backgroundColor="#000000" />
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {renderHeader()}
          <View style={styles.titleSection}>
            <Text style={styles.title}>Password updated</Text>
            <Text style={styles.subtitle}>You can now sign in with your new password.</Text>
          </View>
          <View style={styles.form}>
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={() => {
                console.log("[FlashLocum] AuthScreen: back to sign in from forgot-done");
                setView("form");
                setMode("login");
                setError(null);
              }}
              activeOpacity={0.85}
            >
              <Text style={styles.primaryButtonText}>Back to sign in</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ---- FORM view (default) ----
  const titleText = mode === "signup" ? "Create your account" : "Welcome back";
  const subtitleText =
    mode === "signup" ? "Join the FlashLocum coverage network." : "Sign in to continue.";
  const submitLabel = busy ? "Please wait…" : mode === "signup" ? "Create account" : "Sign in";
  const toggleLabel = mode === "signup" ? "Already have an account?" : "New to FlashLocum?";
  const toggleAction = mode === "signup" ? "Sign in" : "Create one";
  const namePlaceholder = normalizedRole === "cover" ? "Dr. Ada Okafor" : "Ada Okafor";

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="#000000" />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {renderHeader()}

          <View style={styles.titleSection}>
            <Text style={styles.title}>{titleText}</Text>
            <Text style={styles.subtitle}>{subtitleText}</Text>
          </View>

          <View style={styles.form}>
            {mode === "signup" && (
              <View style={styles.fieldContainer}>
                <Text style={styles.fieldLabel}>Full name</Text>
                <TextInput
                  style={styles.input}
                  value={name}
                  onChangeText={setName}
                  autoComplete="name"
                  placeholder={namePlaceholder}
                  placeholderTextColor="#98989D"
                />
              </View>
            )}

            <View style={styles.fieldContainer}>
              <Text style={styles.fieldLabel}>Email</Text>
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete={mode === "signup" ? "email" : "username"}
                placeholder="you@example.com"
                placeholderTextColor="#98989D"
              />
            </View>

            <View style={styles.fieldContainer}>
              <Text style={styles.fieldLabel}>Password</Text>
              <View style={styles.passwordRow}>
                <TextInput
                  style={styles.passwordInput}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPw}
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  placeholder="••••••••"
                  placeholderTextColor="#98989D"
                />
                <TouchableOpacity
                  style={styles.eyeButton}
                  onPress={() => {
                    console.log("[FlashLocum] AuthScreen: toggle password visibility");
                    setShowPw((v) => !v);
                  }}
                  activeOpacity={0.7}
                >
                  {showPw ? <EyeOffIcon /> : <EyeIcon />}
                </TouchableOpacity>
              </View>
              {mode === "login" && (
                <TouchableOpacity
                  style={styles.forgotLink}
                  onPress={() => {
                    console.log("[FlashLocum] AuthScreen: forgot password pressed");
                    setView("forgot");
                    setError(null);
                  }}
                >
                  <Text style={styles.forgotLinkText}>Forgot password?</Text>
                </TouchableOpacity>
              )}
            </View>

            {error ? renderError(error) : null}

            <TouchableOpacity
              style={[styles.primaryButton, styles.primaryButtonTop, busy && styles.buttonDisabled]}
              onPress={handleSubmit}
              disabled={busy}
              activeOpacity={0.85}
            >
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryButtonText}>{submitLabel}</Text>
              )}
            </TouchableOpacity>

            {mode === "signup" && (
              <Text style={styles.termsText}>
                {"By creating an account, you agree to our "}
                <Text
                  style={styles.termsLink}
                  onPress={() => {
                    console.log("[FlashLocum] AuthScreen: open Terms of Service");
                    Linking.openURL("https://flashlocum.com/terms-of-service");
                  }}
                >
                  Terms of Service
                </Text>
                {" and "}
                <Text
                  style={styles.termsLink}
                  onPress={() => {
                    console.log("[FlashLocum] AuthScreen: open Privacy Policy");
                    Linking.openURL("https://flashlocum.com/privacy-policy");
                  }}
                >
                  Privacy Policy
                </Text>
                {"."}
              </Text>
            )}
          </View>

          <View style={styles.toggleContainer}>
            <Text style={styles.toggleText}>{toggleLabel}</Text>
            <Text style={styles.toggleSpacer}> </Text>
            <TouchableOpacity
              onPress={() => {
                console.log(
                  "[FlashLocum] AuthScreen: toggle mode to",
                  mode === "signup" ? "login" : "signup",
                );
                setError(null);
                setMode(mode === "signup" ? "login" : "signup");
              }}
            >
              <Text style={styles.toggleAction}>{toggleAction}</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
    backgroundColor: "#000000",
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 40,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#1C1C1E",
    alignItems: "center",
    justifyContent: "center",
  },
  roleLabel: {
    fontSize: 11,
    letterSpacing: 2,
    color: "#98989D",
    textTransform: "uppercase",
  },
  headerSpacer: {
    width: 36,
    height: 36,
  },
  titleSection: {
    marginTop: 32,
    marginBottom: 8,
  },
  title: {
    fontSize: 26,
    fontWeight: "600",
    color: "#FFFFFF",
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 14,
    color: "#98989D",
    marginTop: 6,
    lineHeight: 20,
  },
  form: {
    marginTop: 20,
    gap: 12,
  },
  fieldContainer: {
    gap: 6,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: "500",
    color: "#98989D",
  },
  input: {
    height: 52,
    backgroundColor: "#1C1C1E",
    borderRadius: 16,
    paddingHorizontal: 16,
    fontSize: 15,
    color: "#FFFFFF",
  },
  passwordRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1C1C1E",
    borderRadius: 16,
    paddingHorizontal: 16,
    height: 52,
  },
  passwordInput: {
    flex: 1,
    fontSize: 15,
    color: "#FFFFFF",
    height: 52,
  },
  eyeButton: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 8,
  },
  forgotLink: {
    alignSelf: "flex-end",
    marginTop: 6,
  },
  forgotLinkText: {
    fontSize: 13,
    fontWeight: "500",
    color: "#98989D",
    textDecorationLine: "underline",
  },
  errorBox: {
    backgroundColor: "rgba(220,38,38,0.15)",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  errorText: {
    fontSize: 13,
    color: "#EF4444",
    lineHeight: 18,
  },
  infoBox: {
    backgroundColor: "rgba(25,60,184,0.15)",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  infoText: {
    fontSize: 13,
    color: "#6B8EF5",
    lineHeight: 18,
  },
  primaryButton: {
    height: 52,
    backgroundColor: "#193CB8",
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonTop: {
    marginTop: 4,
  },
  primaryButtonText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  secondaryButton: {
    height: 48,
    backgroundColor: "#1C1C1E",
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryButtonText: {
    fontSize: 14,
    fontWeight: "500",
    color: "#FFFFFF",
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  textLink: {
    alignItems: "center",
    paddingVertical: 8,
  },
  textLinkText: {
    fontSize: 14,
    color: "#98989D",
    textDecorationLine: "underline",
  },
  otpInput: {
    height: 56,
    backgroundColor: "#1C1C1E",
    borderRadius: 16,
    fontSize: 24,
    fontWeight: "600",
    color: "#FFFFFF",
    letterSpacing: 8,
    textAlign: "center",
  },
  termsText: {
    fontSize: 11,
    color: "#98989D",
    textAlign: "center",
    lineHeight: 16,
  },
  termsLink: {
    textDecorationLine: "underline",
  },
  toggleContainer: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    marginTop: "auto",
    paddingTop: 32,
  },
  toggleText: {
    fontSize: 13,
    color: "#98989D",
  },
  toggleSpacer: {
    fontSize: 13,
  },
  toggleAction: {
    fontSize: 13,
    fontWeight: "500",
    color: "#FFFFFF",
    textDecorationLine: "underline",
  },
});
