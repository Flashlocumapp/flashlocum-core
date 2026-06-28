import * as React from "react";

import { Body, Container, Head, Heading, Html, Preview, Text } from "@react-email/components";

interface SignupEmailProps {
  siteName: string;
  recipient?: string;
  token: string;
}

export const SignupEmail = ({ siteName, recipient, token }: SignupEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>
      Your {siteName} verification code is {token}
    </Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>Confirm your email</Heading>
        <Text style={text}>Your {siteName} verification code is:</Text>
        <Text style={code}>{token}</Text>
        <Text style={text}>
          Enter this 6-digit code in {siteName}
          {recipient ? ` to verify ${recipient}` : ""}. The code expires shortly — request a new one
          if it does not work.
        </Text>
        <Text style={footer}>
          If you didn&apos;t create an account, you can safely ignore this email.
        </Text>
      </Container>
    </Body>
  </Html>
);

export default SignupEmail;

const main = { backgroundColor: "#ffffff", fontFamily: "Arial, sans-serif" };
const container = { padding: "20px 25px" };
const h1 = {
  fontSize: "22px",
  fontWeight: "bold" as const,
  color: "#000000",
  margin: "0 0 20px",
};
const text = {
  fontSize: "14px",
  color: "#55575d",
  lineHeight: "1.5",
  margin: "0 0 20px",
};
const code = {
  fontSize: "32px",
  lineHeight: "40px",
  fontWeight: "bold" as const,
  letterSpacing: "8px",
  color: "#111827",
  margin: "8px 0 24px",
};
const footer = { fontSize: "12px", color: "#999999", margin: "30px 0 0" };
