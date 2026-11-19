// Chrome driven over the DevTools protocol on a pipe, with no dependencies. Chrome reads commands on its fd 3 and
// writes on its fd 4, each message JSON ending in a NUL. There's no port to collide with a Chrome still closing, and a
// fresh profile each time keeps it apart from any Chrome already open, which would otherwise take the launch over
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DEFAULT_CHROME = {
  darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  linux: 'google-chrome',
  win32: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
}

export const CHROME = process.env.CHROME ?? DEFAULT_CHROME[process.platform] ?? 'google-chrome'

const BASE_FLAGS = [
  '--remote-debugging-pipe',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
  '--window-size=1024,768',
]

const TIMEOUT = 60_000

export async function launch({ flags = [], headless = true } = {}) {
  const profile = await mkdtemp(join(tmpdir(), 'greenscreen-chrome-'))
  const args = [...(headless ? ['--headless=new'] : []), ...BASE_FLAGS, `--user-data-dir=${profile}`, ...flags]
  args.push('about:blank')
  const child = spawn(CHROME, args, { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] })
  return new Browser(child, profile)
}

class Connection {
  #id = 0
  #pending = new Map()
  #handlers = new Set()
  #write

  constructor(write, read) {
    this.#write = write
    let buffer = Buffer.alloc(0)
    read.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk])
      let end
      while ((end = buffer.indexOf(0)) !== -1) {
        const message = JSON.parse(buffer.subarray(0, end).toString('utf8'))
        buffer = buffer.subarray(end + 1)
        this.#receive(message)
      }
    })
  }

  #receive(message) {
    if (message.id !== undefined) {
      const pending = this.#pending.get(message.id)
      if (!pending) return
      this.#pending.delete(message.id)
      clearTimeout(pending.timer)
      if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`))
      else pending.resolve(message.result)
      return
    }
    for (const handler of this.#handlers) handler(message)
  }

  send(method, params = {}, sessionId) {
    const id = ++this.#id
    const message = { id, method, params }
    if (sessionId) message.sessionId = sessionId
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id)
        reject(new Error(`${method} timed out`))
      }, TIMEOUT)
      this.#pending.set(id, { resolve, reject, method, timer })
      this.#write.write(`${JSON.stringify(message)}\0`)
    })
  }

  listen(handler) {
    this.#handlers.add(handler)
    return () => this.#handlers.delete(handler)
  }

  fail(error) {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.#pending.clear()
  }
}

class Browser {
  log = ''
  #child
  #profile
  #connection
  #exited

  constructor(child, profile) {
    this.#child = child
    this.#profile = profile
    child.stderr.on('data', (chunk) => {
      this.log += chunk
    })
    this.#connection = new Connection(child.stdio[3], child.stdio[4])
    this.#exited = new Promise((resolve) => child.once('exit', resolve))
    void this.#exited.then(() => this.#connection.fail(new Error(`Chrome exited\n${this.log.slice(-2000)}`)))
  }

  send(method, params) {
    return this.#connection.send(method, params)
  }

  async newPage(url) {
    const { targetId } = await this.send('Target.createTarget', { url: 'about:blank' })
    const { sessionId } = await this.send('Target.attachToTarget', { targetId, flatten: true })
    const page = new Page(this.#connection, sessionId)
    await page.send('Runtime.enable')
    await page.send('Page.enable')
    if (url) await page.goto(url)
    return page
  }

  async close() {
    const child = this.#child
    if (child.exitCode === null && child.signalCode === null) {
      await this.send('Browser.close').catch(() => {})
      const timer = setTimeout(() => child.kill('SIGKILL'), 5000)
      await this.#exited
      clearTimeout(timer)
    }
    await rm(this.#profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}

class Page {
  // What the page printed and threw, in order, for a failure to show
  messages = []
  #connection
  #sessionId

  constructor(connection, sessionId) {
    this.#connection = connection
    this.#sessionId = sessionId
    connection.listen((message) => {
      if (message.sessionId !== sessionId) return
      if (message.method === 'Runtime.consoleAPICalled') {
        const text = message.params.args.map((arg) => arg.value ?? arg.description ?? arg.type).join(' ')
        this.messages.push(`[${message.params.type}] ${text}`)
      } else if (message.method === 'Runtime.exceptionThrown') {
        const details = message.params.exceptionDetails
        this.messages.push(`[exception] ${details.exception?.description ?? details.text}`)
      }
    })
  }

  send(method, params) {
    return this.#connection.send(method, params, this.#sessionId)
  }

  // Resolves with the next event of that name on this page
  next(method) {
    return new Promise((resolve) => {
      const stop = this.#connection.listen((message) => {
        if (message.sessionId !== this.#sessionId || message.method !== method) return
        stop()
        resolve(message.params)
      })
    })
  }

  async goto(url) {
    const loaded = this.next('Page.loadEventFired')
    const { errorText } = await this.send('Page.navigate', { url })
    if (errorText) throw new Error(`${url}: ${errorText}`)
    await loaded
  }

  // The value of the expression, awaited if it's a promise, as JSON
  async evaluate(expression) {
    const { result, exceptionDetails } = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    })
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text)
    return result.value
  }

  // A PNG of what the page shows, as a Buffer
  async screenshot() {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' })
    return Buffer.from(data, 'base64')
  }
}
