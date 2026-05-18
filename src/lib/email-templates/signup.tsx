import * as React from 'react'

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Text,
} from '@react-email/components'

interface SignupEmailProps {
  siteName: string
  siteUrl: string
  recipient: string
  confirmationUrl: string
}

export const SignupEmail = ({
  siteName,
  siteUrl,
  recipient,
  confirmationUrl,
}: SignupEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Welcome to Tarot Seed</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>Welcome to Tarot Seed</Heading>
        <Text style={text}>
          Please confirm your email address to begin your journey.
        </Text>
        <Button style={button} href={confirmationUrl}>
          Confirm My Email
        </Button>
        <Text style={footer}>
          If you didn't create this account, you can safely ignore this email.
        </Text>
      </Container>
    </Body>
  </Html>
)

export default SignupEmail

const main = { backgroundColor: '#1a1020', fontFamily: 'Georgia, serif' }
const container = {
  padding: '40px 30px',
  maxWidth: '480px',
  margin: '0 auto',
}
const h1 = {
  fontFamily: 'Georgia, serif',
  fontSize: '24px',
  color: '#e8ddd0',
  fontStyle: 'italic' as const,
  fontWeight: 'normal' as const,
  margin: '0 0 24px',
}
const text = {
  fontFamily: 'Georgia, serif',
  fontSize: '16px',
  color: '#b0a090',
  lineHeight: '1.6',
  margin: '0 0 28px',
}
const button = {
  backgroundColor: '#d4af37',
  color: '#1a1205',
  fontFamily: 'Georgia, serif',
  fontSize: '16px',
  fontStyle: 'italic' as const,
  borderRadius: '24px',
  padding: '14px 32px',
  textDecoration: 'none',
}
const footer = {
  fontFamily: 'Georgia, serif',
  fontSize: '13px',
  color: '#706050',
  margin: '32px 0 0',
}
