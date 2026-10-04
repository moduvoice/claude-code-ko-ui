import type { Register } from 'claude-code'

type Dict = {
  commands: Record<string, string>
  hints: Record<string, string>
  config: Record<string, { label?: string; description?: string }>
  patterns: { re: string; to: string }[]
  promptHints: Record<string, string>
  modes: Record<string, string>
}

const EMPTY: Dict = {
  commands: {},
  hints: {},
  config: {},
  patterns: [],
  promptHints: {},
  modes: {},
}

const MISSING_MAX = 200
const ANSI = new RegExp('\\u001b\\[[0-9;]*m', 'g')
const HANGUL = /[가-힣]/
const SPINNER: Record<string, string> = {
  thinking: '생각하는 중',
  requesting: '요청하는 중',
  responding: '응답하는 중',
  'tool-use': '도구 실행 중',
  'tool-input': '도구 입력 준비 중',
}

let dict: Promise<Dict> | undefined
let queue: Promise<unknown> = Promise.resolve()
const seen = new Set<string>()

function load($: any): Promise<Dict> {
  dict ??= $.fs
    .read(`${$.plugin.root}/dict.json`)
    .then((t: string) => ({ ...EMPTY, ...JSON.parse(t) }))
    .catch(() => EMPTY)
  return dict
}

// 번역하지 못한 문구를 $.store 에 모아 두어 사전에 추가할 수 있게 한다.
function record($: any, kind: string, text: string) {
  const t = text.replace(ANSI, '').trim()
  if (!t || HANGUL.test(t) || t.length > 2000) return
  const line = `[${kind}] ${t}`
  if (seen.has(line)) return
  seen.add(line)
  queue = queue.then(async () => {
    const old = ((await $.store.get('missing')) as string[] | undefined) ?? []
    if (old.includes(line) || old.length >= MISSING_MAX) return
    await $.store.set('missing', [...old, line])
  })
}

function tr(d: Dict, text: string): string {
  let out = text.replace(ANSI, '')
  out = out.replace(/^Set (\S+(?: \S+)*?) to (.+)$/gm, (_m, key: string, val: string) => {
    return `설정 변경: ${d.config[key]?.label ?? key} → ${val}`
  })
  for (const p of d.patterns) {
    try {
      out = out.replace(new RegExp(p.re, 'gm'), p.to)
    } catch {
      // 잘못된 정규식은 건너뛴다
    }
  }
  return out
}

function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  if (h > 0) return `${h}시간 ${m}분`
  if (m > 0) return `${m}분 ${r}초`
  return `${r}초`
}

const GROUP_ORDER = ['search', 'read', 'list', 'shell']
const GROUP_OF: Record<string, string> = {
  Grep: 'search',
  Glob: 'search',
  Read: 'read',
  LS: 'list',
  Bash: 'shell',
  PowerShell: 'shell',
}
const GROUP_TEXT: Record<string, (n: number, active: boolean) => string> = {
  search: (n, a) => `패턴 ${n}개 ${a ? '검색 중' : '검색함'}`,
  read: (n, a) => `파일 ${n}개 ${a ? '읽는 중' : '읽음'}`,
  list: (n, a) => `디렉터리 ${n}개 ${a ? '나열 중' : '나열함'}`,
  shell: (n, a) => `셸 명령 ${n}개 ${a ? '실행 중' : '실행함'}`,
}

// 접힌 도구 호출 요약 줄. 모르는 도구가 섞여 있으면 undefined (원문 유지).
function groupLine(calls: ReadonlyArray<{ tool: string }>, active: boolean): string | undefined {
  const count: Record<string, number> = {}
  for (const c of calls) {
    const g = GROUP_OF[c.tool]
    if (!g) return undefined
    count[g] = (count[g] ?? 0) + 1
  }
  const parts = GROUP_ORDER.filter(g => count[g]).map(g => GROUP_TEXT[g](count[g], active))
  return parts.length > 0 ? parts.join(', ') : undefined
}

// 키 이름(esc, ctrl+c 등)을 뺀 뒤에도 영어 단어가 남으면 번역이 덜 된 것이다.
function isFullyKorean(text: string): boolean {
  const rest = text.replace(/\b(ctrl|shift|alt|esc|tab|enter|cmd|opt|fn)\b[+\w-]*/gi, '')
  return !/[A-Za-z]{3,}/.test(rest)
}

function trHint(d: Dict, hint: string): string | undefined {
  if (d.promptHints[hint]) return d.promptHints[hint]
  const keys = Object.keys(d.promptHints).sort((a, b) => b.length - a.length)
  let out = hint
  for (const k of keys) out = out.split(k).join(d.promptHints[k])
  return out !== hint && isFullyKorean(out) ? out : undefined
}

type Todo = { commands: Record<string, string>; config: Record<string, string>; texts: string[] }

// 사전에 없는 영어 문구를 찾는다. 번역은 하지 않는다.
async function scan($: any): Promise<Todo> {
  const d = await load($)
  const need = (t?: string) => !!t && t.trim() !== '' && !HANGUL.test(t)
  const todo: Todo = { commands: {}, config: {}, texts: [] }
  const commands: any[] = await $.command.list()
  for (const c of commands) {
    if (c.plugin !== 'ko-ui' && need(c.description) && !d.commands[c.name]) {
      todo.commands[c.name] = c.description
    }
  }
  const config: any[] = await $.config.list()
  for (const r of config) {
    if (need(r.label) && !d.config[r.key]?.label) todo.config[r.key] = r.label
  }
  todo.texts = ((await $.store.get('missing')) as string[] | undefined) ?? []
  return todo
}

// 새 커맨드나 설정이 번역 안 된 채 보이면 한 번 알려 준다. (업데이트 직후에 해당)
async function notify($: any) {
  const t = await scan($)
  const n = Object.keys(t.commands).length + Object.keys(t.config).length
  if (n > 0) {
    await $.ui.toast(
      `ko-ui: 번역 안 된 새 항목 ${n}개 발견. /ko-dump 로 목록을 보고 dict.json 에 번역을 추가하세요`,
    )
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'ko-dump',
      description: '사전에 없는 영어 커맨드·설정·화면 문구 목록을 보여줍니다',
    })
    await $.ui.invalidate('command.describe')
    await $.ui.invalidate('config.describe')
    $.clock.after(8000, () => {
      void notify($)
    })
    return next(e)
  })

  on('command.run', { command: 'ko-dump' }, async $ => {
    const t = await scan($)
    const cmds = Object.entries(t.commands).map(([k, v]) => `- /${k}: ${v}`)
    const cfgs = Object.entries(t.config).map(([k, v]) => `- ${k}: ${v}`)
    const lines = [
      `번역 안 된 항목: 커맨드 ${cmds.length}개, 설정 ${cfgs.length}개, 화면 문구 ${t.texts.length}개`,
      ...(cmds.length ? ['', '[커맨드]', ...cmds] : []),
      ...(cfgs.length ? ['', '[설정]', ...cfgs] : []),
      ...(t.texts.length ? ['', '[화면 문구]', ...t.texts.map(x => `- ${x}`)] : []),
    ]
    return { text: lines.join('\n') }
  })

  on('command.describe', async ($, e, next) => {
    const d = await load($)
    const r = await next(e)
    return {
      ...r,
      description: d.commands[e.command] ?? r.description,
      argumentHint: r.argumentHint && (d.hints[e.command] ?? r.argumentHint),
    }
  })

  on('config.describe', async ($, e, next) => {
    const d = await load($)
    const r = await next(e)
    const t = d.config[e.key]
    return {
      ...r,
      label: t?.label ?? r.label,
      description: t?.description ?? r.description,
    }
  })

  on('ui.render', { component: 'CommandOutput' }, async ($, e, next) => {
    const d = await load($)
    const text = e.props.text
    const out = tr(d, text)
    if (out === text.replace(ANSI, '')) {
      record($, `${e.props.command}`, text)
      return next(e)
    }
    return next({ ...e, props: { ...e.props, text: out } })
  })

  on('ui.render', { component: 'InfoNotice' }, async ($, e, next) => {
    const d = await load($)
    const text = e.props.text
    const out = tr(d, text)
    if (out === text.replace(ANSI, '')) {
      record($, 'notice', text)
      return next(e)
    }
    return next({ ...e, props: { ...e.props, text: out } })
  })

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const d = await load($)
    const out = trHint(d, e.props.hint)
    if (out === undefined) {
      record($, 'hint', e.props.hint)
      return next(e)
    }
    return next({ ...e, props: { ...e.props, hint: out } })
  })

  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const d = await load($)
    const modes = e.props.modes.map(m => {
      if (d.modes[m]) return d.modes[m]
      record($, 'mode', m)
      return m
    })
    return next({ ...e, props: { ...e.props, modes } })
  })

  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const d = await load($)
    const p = e.props
    let message = p.message
    if (message !== null) {
      const out = tr(d, message)
      if (out === message.replace(ANSI, '')) record($, 'spinner', message)
      else message = out
    }
    return next({ ...e, props: { ...p, word: SPINNER[p.mode] ?? p.word, message } })
  })

  on('ui.render', { component: 'ToolProgress' }, async ($, e, next) => {
    const m = /^\((.+) to run in background\)$/.exec(e.props.hint)
    if (!m) {
      record($, 'progress', e.props.hint)
      return next(e)
    }
    return next({ ...e, props: { ...e.props, hint: `(${m[1]} 로 백그라운드 실행)` } })
  })

  on(
    'ui.render',
    { component: 'UserMessage', props: { origin: { kind: 'task-notification' } } },
    async ($, e, next) => {
      const d = await load($)
      const text = e.props.text
      const out = tr(d, text)
      if (out === text.replace(ANSI, '')) {
        record($, 'task-notification', text)
        return next(e)
      }
      return next({ ...e, props: { ...e.props, text: out } })
    },
  )

  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    if (e.props.isExpanded) return next(e)
    const line = groupLine(e.props.calls, e.props.isActive)
    if (line === undefined) {
      record($, 'toolgroup', e.props.calls.map(c => c.tool).join(','))
      return next(e)
    }
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="row">
        <Text>
          ● {line}
          {e.props.isActive ? '…' : ''}
        </Text>
        <Text dimColor> (ctrl+o 로 펼치기)</Text>
      </Box>
    )
  })

  on('ui.render', { component: 'TurnDuration' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text dimColor>✻ {duration(e.props.durationMs)} 동안 작업했습니다</Text>
  })
}
