import { notFound } from 'next/navigation'
import { generateStaticParamsFor, importPage } from 'nextra/pages'
import { useMDXComponents as getMDXComponents } from '../../../mdx-components'

export const generateStaticParams = generateStaticParamsFor('mdxPath')

export async function generateMetadata(props: {
  params: Promise<{ mdxPath?: string[] }>
}) {
  const params = await props.params
  try {
    const { metadata } = await importPage(params.mdxPath)
    return metadata
  } catch {
    return {}
  }
}

const Wrapper = getMDXComponents().wrapper

export default async function Page(props: {
  params: Promise<{ mdxPath?: string[] }>
}) {
  const params = await props.params
  // The catch-all matches anything the static file middleware didn't
  // serve first — e.g. requests to /icon.svg before the favicon
  // exists, or /_pagefind/pagefind.js before the search index is
  // built. importPage throws on those paths; delegate to Next's
  // notFound() so we get a clean 404 instead of a console error
  // stack and a 500.
  let imported
  try {
    imported = await importPage(params.mdxPath)
  } catch {
    notFound()
  }
  const { default: MDXContent, toc, metadata } = imported
  return (
    <Wrapper toc={toc} metadata={metadata}>
      <MDXContent {...props} params={params} />
    </Wrapper>
  )
}
