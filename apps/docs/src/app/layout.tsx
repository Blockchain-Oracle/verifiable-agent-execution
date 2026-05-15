import { Footer, Layout, Navbar } from 'nextra-theme-docs'
import { Head } from 'nextra/components'
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
}

const logo = <b>AGENTSCAN</b>

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
          navbar={
            <Navbar
              logo={logo}
              projectLink="https://github.com/Blockchain-Oracle/verifiable-agent-execution"
            />
          }
          pageMap={pageMap}
          docsRepositoryBase="https://github.com/Blockchain-Oracle/verifiable-agent-execution/tree/main/apps/docs"
          editLink="Edit this page on GitHub"
          sidebar={{ defaultMenuCollapseLevel: 1 }}
          footer={
            <Footer>
              {`© ${new Date().getFullYear()} AGENTSCAN — Etherscan for AI agents. Anchored on 0G.`}
            </Footer>
          }
        >
          {children}
        </Layout>
      </body>
    </html>
  )
}
