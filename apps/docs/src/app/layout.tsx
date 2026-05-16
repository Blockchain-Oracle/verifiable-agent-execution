import Image from 'next/image'
import { Banner, Head } from 'nextra/components'
import { Footer, Layout, Navbar } from 'nextra-theme-docs'
import { getPageMap } from 'nextra/page-map'
import 'nextra-theme-docs/style.css'
import './globals.css'

export const metadata = {
  title: {
    template: '%s — AGENTSCAN docs',
    default: 'AGENTSCAN — Etherscan for AI agents',
  },
  description:
    'AGENTSCAN end-user docs. Install the plugin, share verifiable agent receipts, decrypt them in the dashboard, and verify any session cold from a URL.',
  applicationName: 'AGENTSCAN',
  icons: {
    icon: [
      { url: '/icon.svg', type: 'image/svg+xml' },
      { url: '/favicon.ico', type: 'image/x-icon', sizes: '48x48' },
    ],
  },
}

// Logo: the brand mark from /public/logo.svg. SVG inherits
// currentColor for the wordmark, so it adapts to nav text color in
// both light + dark modes. Using next/image for optimization
// (Abu's 2026-05-15 nudge — same primitive as the dashboard's
// TopBar uses).
const logo = (
  <Image
    src="/logo.svg"
    alt="AGENTSCAN"
    width={156}
    height={28}
    priority
    style={{ height: 28, width: 'auto' }}
  />
)

// Banner at the very top — dismissible, links to the live dashboard.
// Useful for judges/devs who hit docs first and need to jump to the
// actual product. Storage key is bumped per release so we can announce
// new features without leaving the old strip dismissed forever.
const banner = (
  <Banner storageKey="agentscan-docs-banner-v1">
    🟢 LIVE on 0G — testnet <a href="https://agentscan.online" style={{ textDecoration: 'underline' }}>agentscan.online</a> · mainnet <a href="https://mainnet.agentscan.online" style={{ textDecoration: 'underline' }}>mainnet.agentscan.online</a>
  </Banner>
)

// Footer: thin three-column with the actual useful destinations.
// Replaces the prior one-line "© AGENTSCAN" boilerplate (Abu's
// 2026-05-15 critique: "the footer isn't very well done").
const footer = (
  <Footer>
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: '1.5rem',
        width: '100%',
        fontSize: '0.875rem',
      }}
    >
      <div>
        <div style={{ fontWeight: 600, marginBottom: '0.5rem' }}>Product</div>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, lineHeight: '1.8' }}>
          <li><a href="https://agentscan.online">Live dashboard (testnet)</a></li>
          <li><a href="https://mainnet.agentscan.online">Live dashboard (mainnet)</a></li>
          <li><a href="https://www.npmjs.com/package/@blockchainoracle/openclaw-verifiable-execution">npm package</a></li>
        </ul>
      </div>
      <div>
        <div style={{ fontWeight: 600, marginBottom: '0.5rem' }}>Docs</div>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, lineHeight: '1.8' }}>
          <li><a href="/quickstart">Quickstart</a></li>
          <li><a href="/architecture">Architecture</a></li>
          <li><a href="/commands">Commands</a></li>
          <li><a href="/developers">For developers</a></li>
        </ul>
      </div>
      <div>
        <div style={{ fontWeight: 600, marginBottom: '0.5rem' }}>Open source</div>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, lineHeight: '1.8' }}>
          <li><a href="https://github.com/Blockchain-Oracle/agentscan">GitHub</a></li>
          <li><a href="https://github.com/Blockchain-Oracle/agentscan/blob/main/LICENSE">Apache-2.0</a></li>
          <li><a href="https://0g.ai">Anchored on 0G</a></li>
        </ul>
      </div>
    </div>
  </Footer>
)

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const pageMap = await getPageMap()

  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <Head>
        <link rel="icon" href="/icon.svg" type="image/svg+xml" />
      </Head>
      <body>
        <Layout
          banner={banner}
          navbar={
            <Navbar
              logo={logo}
              // Per Abu 2026-05-15: header's "project link" should go
              // to the LIVE PRODUCT, not GitHub. From the docs site,
              // the natural next click is "go see the dashboard."
              // GitHub still links from the footer's Open source column.
              projectLink="https://agentscan.online"
            />
          }
          pageMap={pageMap}
          docsRepositoryBase="https://github.com/Blockchain-Oracle/agentscan/tree/main/apps/docs"
          editLink="Edit this page on GitHub"
          sidebar={{ defaultMenuCollapseLevel: 1 }}
          footer={footer}
        >
          {children}
        </Layout>
      </body>
    </html>
  )
}
