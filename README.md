# ko-ui — Claude Code 한국어 UI 번역 mod

Claude Code 의 `/` 슬래시 커맨드 설명, `/config` 항목, 일부 화면 문구를 한국어로 보여주는 **사전 방식** mod 입니다.
번역은 `dict.json` 에 들어 있는 고정 사전만 사용합니다. 모델 호출도, 네트워크 요청도 없고, 모델에 보내는 프롬프트나 컨텍스트는 건드리지 않아서 **토큰이 들지 않습니다.**

> English: A dictionary-based mod that shows Claude Code's slash-command descriptions, `/config` rows and some transcript lines in Korean. It only reads a static `dict.json`: no model calls, no network, nothing added to the model's context.

## 번역되는 것

| 대상 | 방식 | 상태 |
| --- | --- | --- |
| `/` 입력 시 나오는 슬래시 커맨드 설명 (내장 커맨드, 스킬, 플러그인) | `command.describe` | 확인함 |
| `/config` 항목 이름 (44개) | `config.describe` | 확인함 |
| 작업 중 표시 (Spinner) 의 단어 | `ui.render` `Spinner` | 확인함 |
| 턴 종료 줄 (`Baked for 3s` → `✻ 3초 동안 작업했습니다`) | `ui.render` `TurnDuration` | 확인함 |
| 접힌 도구 호출 요약 (`Read 3 files` → `파일 3개 읽음`) | `ui.render` `ToolGroup` | 확인함 |
| `(ctrl+b to run in background)` 안내 | `ui.render` `ToolProgress` | 확인함 |
| 커맨드 출력 줄 (`Set … to …`, 색상 설정 등), 시작 알림, 푸터 모드 라벨, 백그라운드 작업 알림 | `ui.render` + `dict.json` 의 `patterns` | 일부 문구만 사전에 있음 |

"확인함" 은 Claude Code 2.1.289 (Windows) 의 실제 세션에서 한국어로 뜨는 것을 본 항목입니다. 마지막 줄의 출력 문구는 훅은 걸려 있지만 사전에 들어 있는 문구만 번역됩니다. 영어로 남은 문구는 `/ko-dump` 로 확인해 `dict.json` 에 추가하거나 이슈로 알려 주세요.

## 번역할 수 없는 것

mod API 에 훅이 없는 화면은 건드릴 수 없습니다. 번들 파일을 직접 패치하는 방식은 쓰지 않습니다.

- 프롬프트 아래 줄의 알약(`auto mode on`, `update installed · restart to update`, `(shift+tab to cycle)` 등). 줄 전체를 바꾸는 훅만 있어서, 번역하면 현재 모드 표시가 사라지므로 영어로 둡니다.
- 권한 확인 창, 환영 화면, `/config`·`/model` 하위 선택 화면, 선택지 값(`auto`, `dark`, `plan` 등), 에러 메시지, 팁.
- 도구 호출 행 자체(`Bash(ls)`, `Interrupted`)와 작업 중 줄의 `(12s, 300 tokens)`.

## 설치

Claude Code **2.1.287 이상**이 필요합니다. 2.1.289, Windows 에서 만들고 시험했습니다. 2.1.285 에서는 mod 가 기본으로 꺼져 있어서 `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` 환경 변수를 켜야 로드됩니다. 이 경우에도 `/ko-dump` 동작은 확인했습니다.

```sh
git clone https://github.com/moduvoice/claude-code-ko-ui
```

**한 세션만 써 보기**

```sh
claude --plugin-dir ./claude-code-ko-ui
```

**모든 새 세션에 적용하기**: `~/.claude/settings.json` 의 `env` 에 `CLAUDE_CODE_PLUGIN_DIRS` 로 클론한 폴더를 등록합니다. 여러 개면 Windows 에서는 `;` 로 구분합니다.

```json
{
  "env": {
    "CLAUDE_CODE_PLUGIN_DIRS": "C:\\path\\to\\claude-code-ko-ui"
  }
}
```

새 세션을 열면 적용됩니다.

## 번역 고치기, 추가하기

모든 번역은 `dict.json` 에 있습니다. 어색한 문장은 직접 고치면 됩니다. 새 세션부터 반영됩니다.

| 키 | 내용 |
| --- | --- |
| `commands` | 슬래시 커맨드 이름 → 한국어 설명 |
| `config` | `/config` 키 → `{ label, description }` |
| `patterns` | 커맨드 출력 줄에 적용할 정규식 `{ re, to }` 목록 |
| `promptHints` | 프롬프트 아래 힌트 문구 (문장 전체가 한국어가 될 때만 적용) |
| `modes` | 푸터 모드 라벨 |

### Claude Code 업데이트 후

업데이트로 새 커맨드나 설정이 생기면, 세션 시작 약 8초 뒤에 번역이 없는 항목이 있을 때만 토스트로 알려 줍니다. 이 확인도 코드로만 하고 모델은 부르지 않습니다.

- `/ko-dump`: 사전에 없는 영어 커맨드 설명, 설정 이름, 화면 문구 목록을 보여 줍니다. 이 목록을 번역해서 `dict.json` 에 추가하세요.
- 번역되지 않은 화면 문구는 `$.store` 에 최대 200개까지 모아 둡니다.

## mod 가 접근하는 범위

`claude plugin validate` 가 보고하는 범위입니다.

- 읽기: 이 mod 폴더의 `dict.json`, 커맨드·설정 목록 (`$.command.list`, `$.config.list`)
- 저장: 이 mod 의 `$.store` (번역하지 못한 문구 목록)
- 화면: `ui.render`, 토스트, `/ko-dump` 커맨드 등록
- 파일 쓰기, 프로세스 실행, 네트워크, 모델 호출: 없음

## 라이선스

MIT
