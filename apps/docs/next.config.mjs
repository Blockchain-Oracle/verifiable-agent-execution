import nextra from 'nextra'

const withNextra = nextra({
  search: { codeblocks: true },
})

export default withNextra({
  reactStrictMode: true,
})
