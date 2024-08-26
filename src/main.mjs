import 'dotenv/config'
import fs from 'fs-extra'
import { Feed } from 'feed'
import { Octokit } from 'octokit'

const LIMIT = 1000
const DOMAIN = 'https://wangchujiang.com/releases'

const octokit = new Octokit({ auth: process.env.TOKEN })
const ignoreRepos = []

async function fetchRepo(owner, name) {
  console.log(`Fetching repository details for ${owner}/${name}`)
  const { data } = await octokit.request('GET /repos/{owner}/{name}', {
    owner,
    name,
  })
  return data
}

async function getMyPullRequest() {
  // Fetch user from token
  const userResponse = await octokit.request('GET /user')
  const user = {
    name: userResponse.data.name ?? userResponse.data.login,
    username: userResponse.data.login,
    avatar: userResponse.data.avatar_url,
  }
  // Fetch pull requests from user
  const { data } = await octokit.request('GET /search/issues', {
    q: `type:pr+author:"${user.username}"+-user:"${user.username}"`,
    per_page: 50,
    page: 1,
  })

  // Filter out closed PRs that are not merged
  const filteredPrs = data.items.filter(pr => !(pr.state === 'closed' && !pr.pull_request?.merged_at))
  const prs = []
  // For each PR, fetch the repository details
  for (const pr of filteredPrs) {
    const [owner, name] = pr.repository_url.split('/').slice(-2)
    const repo = await fetchRepo(owner, name)

    prs.push({
      id: pr.id,
      type: repo.owner.type, // Add type information (User or Organization)
      repo: `${owner}/${name}`,
      title: pr.title.trim(),
      url: pr.html_url,
      created_at: pr.created_at,
      state: pr.pull_request?.merged_at ? 'merged' : pr.state, // as 'open' | 'closed',
      number: pr.number,
      stars: repo.stargazers_count,
    })
  }

  return {
    user,
    prs,
  }
}

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
          url: `https://github.com/${item.repo.name}/commit/${commit?.sha}`,
          created_at: item.created_at,
          state: "tagged",
          version,
          // payload: item.payload,
        }
      })
    })
    //.filter(item => item.version)
    .filter(item => item.title.includes('release') && item.version)
}

async function getReleasesData() {
  let infos = []
  let goNextPage = true
  for (let page = 1; page <= 3; page++) {
    if (!goNextPage) break
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
  return infos
}

;(async () => {
  // {
  //   "id": "41233191269",
  //   "type": "PushEvent",
  //   "repo": "jaywcjlove/recursive-readdir-files",
  //   "title": "released v2.3.2",
  //   "url": "https://github.com/jaywcjlove/recursive-readdir-files/commit/65739491d2750b3ee242425268f9e13834092a6e",
  //   "created_at": "2024-08-22T03:13:25Z",
  //   "sha": "65739491d2750b3ee242425268f9e13834092a6e",
  //   "version": "2.3.2"
  // }
  let infos = await getReleasesData()
  // {
  //   id: 496622301,
  //   type: 'User',
  //   repo: 'vkarampinis/awesome-icons',
  //   title: 'Add uiw-icons and svgtofont tools .',
  //   url: 'https://github.com/vkarampinis/awesome-icons/pull/16',
  //   created_at: '2019-09-21T06:48:39Z',
  //   state: 'merged',
  //   number: 16,
  //   stars: 1273
  // },
  const myPullRequest = await getMyPullRequest()

  const datas = infos.concat(myPullRequest.prs)
  datas.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
  datas.reverse()

  await fs.ensureDir("dist")
  fs.writeJSONSync("dist/data.json", datas, { spaces: 2 })
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

  for (const item of datas) {
    if (infos.state) {
      feed.addItem({
        id: item.id,
        link: item.url,
        date: new Date(item.created_at),
        title: item.title,
        image: `https://github.com/${item.repo.split('/')[0]}.png`,
        description: `<a href="${item.url}">${item.title}</a>`,
      })
    } else {
      feed.addItem({
        id: item.id,
        link: `https://github.com/${item.repo}/releases/tag/v${item.version}`,
        date: new Date(item.created_at),
        title: `${item.repo} v${item.version} released`,
        image: `https://github.com/${item.repo.split('/')[0]}.png`,
        description: `<a href="${item.commit}">${item.title}</a>`,
      })
    }
  }
  fs.writeFileSync("dist/rss.xml", feed.rss2())
  console.log("♻️ RSS feed generated -> dist/rss.xml")
})()

