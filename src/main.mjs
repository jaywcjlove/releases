import 'dotenv/config'
import fs from 'fs-extra'
import { Feed } from 'feed'
import { Octokit } from 'octokit'

const LIMIT = 100
const DOMAIN = 'https://wangchujiang.com/releases'

const octokit = new Octokit({
  auth: process.env.TOKEN,
})
const ignoreRepos = [
]
async function getDataAtPage(page = 1) {
  const { data } = await octokit.request('GET /users/{username}/events', {
    username: "jaywcjlove",
    per_page: 100,
    page,
  })

  return data
    .filter(item => item.type === 'PushEvent' && item.public && !ignoreRepos.includes(item.repo.name))
    .flatMap((item) => {
      const payload = item.payload || {}
      return (payload.commits || []).map((commit) => {
        const title = (commit?.message || '').split('\n')[0]
        const version = title.match(/v?(\d+\.\d+\.\d+(?:-[\w.]+)?)(?:\s|$)/)?.[1] || ''
        return {
          id: item.id,
          type: item.type,
          repo: item.repo.name,
          title,
          sha: commit?.sha || '',
          commit: `https://github.com/${item.repo.name}/commit/${commit?.sha}`,
          created_at: item.created_at,
          version,
          // payload: item.payload,
        }
      })
    })
    .filter(item => item.title.includes('release') && item.version)
}

;(async () => {
  let infos = []
  let goNextPage = true
  for (let page = 1; page <= 3; page++) {
    if (!goNextPage)
      break
    try {
      const items = await getDataAtPage(page)
      for (let index = items.length - 1; index >= 0; index--) {
        const current = items[index]
        const found = infos.find(item => item.id === current.id)
        if (found) {
          goNextPage = false
          continue
        }
        infos.push(current)
      }
    }
    catch (error) {
      console.error(error)
      goNextPage = false
      break
    }
  }

  // Sort from oldest to newest (will be reversed later)
  infos.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())

  // Filter out continuse releases, keep only the latest one
  infos = infos.filter((info, index) => {
    const next = infos[index + 1]
    if (next && info.repo === next.repo)
      return false
    return true
  })

  infos.reverse()

  if (infos.length > LIMIT) {
    infos.slice(0, LIMIT)
  }

  await fs.ensureDir("dist")
  fs.writeJSONSync("dist/data.json", infos, { spaces: 2 })
  console.log("♻️ Data generated -> dist/data.json")
  
  const feed = new Feed({
    title: 'Kenny Wang is Releasing...',
    description: 'Kenny Wang\'s recent releases',
    id: DOMAIN,
    link: DOMAIN,
    language: 'en',
    image: `${DOMAIN}/favicon.png`,
    favicon: `${DOMAIN}/favicon.png`,
    copyright: 'CC BY-NC-SA 4.0 2024 © Kenny Wang',
    feedLinks: {
      rss: `${DOMAIN}/rss.xml`,
    },
  })


  for (const item of infos) {
    feed.addItem({
      id: item.id,
      link: `https://github.com/${item.repo}/releases/tag/v${item.version}`,
      date: new Date(item.created_at),
      title: `${item.repo} v${item.version} released`,
      image: `https://github.com/${item.repo.split('/')[0]}.png`,
      description: `<a href="${item.commit}">${item.title}</a>`,
    })
  }
  fs.writeFileSync("dist/rss.xml", feed.rss2())
  console.log("♻️ RSS feed generated -> dist/rss.xml")
})()

