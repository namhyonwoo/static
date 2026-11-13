/* DefenseGame: 디펜스 모드 조립 (원소스 멀티유즈의 첫 게임 — 한 사이클 뼈대).
   RTS 모드(rts.js)와 같은 원본 데이터·그림·소리·전투 공식을 그대로 쓰고, "게임 규칙"만 이 파일에 새로 썼다.

   ■ 다시 쓰는 것 (공용 엔진 mw/ 와 원본 에셋 sim/)
     - MWE.UnitType / MWE.Unit : 유닛 수치, 방향, 애니메이션 프레임 고르기 (core/unit.js)
     - MWE.OriginalRules       : 원본 피해 공식·공격 간격·무기/방어 강화 배수 (core/rules.js)
     - MWE.GameMap / TerrainRenderer : 원본 맵 지형을 배경으로 (core/gamemap.js, render/terrain.js)
     - MWE.Assets / MWE.Sfx / MWE.Bgm : 그림·효과음·배경음 (render/assets.js, ui/sfx.js, ui/hud.js)
     - MW.units / MW.fx / MW.map2 : 원본에서 뽑은 데이터 (sim/data.js)
     - MW_DEF + defense.png       : 원본 건물 그림(성·마굴)을 이 게임 크기로 구운 것 (sim/defense.js, tools/defbuild.js)

   ■ 이 파일의 구성 (위에서 아래로 읽으면 된다)
     1. CONFIG    — 숫자만 바꿔도 게임이 달라지는 설정 (탭·웨이브·마나·마법 유닛 제한 …)
     2. 준비      — 캔버스 크기 맞추기, 에셋 불러오기, 버튼 배치
     3. 한 판     — reset(), 유닛 소환(spawn / summon)과 소환 검증(canSummon)
     4. 스킬      — SkillSlot(유닛과 1:1로 묶인 스킬 칸) 만들기·없애기·쿨타임, 스킬 종류별 효과
     5. update()  — 웨이브 → 유닛 행동 → 발사체 → 승패 판정 (1초에 60번쯤)
     6. draw()    — 배경 → 건물 → 유닛 → 이펙트 → HUD(왼쪽 소환 패널, 오른쪽 스킬 패널)
     7. 입력      — 버튼 누르기 (마우스·터치 공통), 단축키

   ■ 유닛 두 종류
     - 일반 유닛: 마나만 있으면 몇 기든 소환.
     - 마법 유닛: 마법(마나를 쓰는 원본 행동)을 가진 유닛. 수 제한 없음 — 같은 마법은 패널의 한 칸(묶음)으로 모인다.
       소환되면 그 유닛의 마법 전부가 오른쪽 아래 스킬 패널에 칸(SkillSlot)으로 생기고, 쓰러지면 그 칸들도 사라진다.
       칸이 3개를 넘으면 패널을 좌우로 넘겨 본다(캐러셀).
       스킬 패널 위의 유닛 칩을 두 번 누르면 그 유닛을 회수한다(recall) — 마나를 일부 돌려받고 자리가 빈다.
     - 성 배치(건물 원거리 공격): 원본 규칙(분석 8-35) — 건물은 스스로 공격하지 않고, 안에 든 "건물 무기 등급" 유닛이 건물에서 쏜다.
       성을 눌러 고른 동안(전에는 [성 배치] 토글) 궁수·명궁·창검사·마법사·장로를 소환하면 전장 대신 성에 들어가 무기가 전개되고, 사거리 안의 적(공중 포함)을 쏜다.
       정령사·연금술사·마법전사·마법기사는 성 안에서 사격 피해를 올려 준다.
     - 공중 유닛(엔젤 나이트): 지상 유닛 위를 그냥 지나가고, 지상 근접 유닛은 공중 유닛을 때리지 못한다.

   화면: 가로 모드와 세로 모드를 모두 지원한다. 게임 안 크기(W × H)는 기기에 맞춰 정하고(CONFIG.SCREEN, _resize), 버튼 배치는 _layout이 모드별로 짠다.
   전장은 화면보다 긴 가로 WORLD_W(2000px)이고, 카메라(cam.x)가 좌우로 움직이며 그 일부를 비춘다.
     유닛·건물·이펙트의 x = 전장 좌표,  화면 x = 전장 x − cam.x
   전투는 왼쪽(아군 기지) ↔ 오른쪽(적 출구) 사이에서 벌어지고, 유닛은 세로 5줄에 나뉘어 선다. */
(function (root) {
  'use strict';
  var MWE = root.MWE;

  /* ───────────────────────── 1. CONFIG ───────────────────────── */
  var CONFIG = {
    /* 화면 크기 정하기 (_resize). "게임 안 크기" = 실제 화면 크기 ÷ 확대 배수. 게임 안 크기가 작을수록 유닛·버튼이 크게 보인다.
         이 게임은 **세로 전용**이다(아이폰의 세로 고정 앱처럼). 세로 화면: 가로 = 화면 가로 ÷ portZoom (아이폰 12 → 390, 1배), 세로는 화면 비율대로.
         가로 화면·PC: 배치를 바꾸지 않고 기준 크기(refW × refH = 아이폰 12 세로)를 그대로 쓴다 — CSS object-fit: contain 이 가운데에 세워 놓고 좌우는 검은 여백.
         (2026-11-12 사용자 요청: 가로 배치는 전장이 낮아 답답해서 없앰) */
    SCREEN: { portZoom: 1, portMinW: 340, portMaxW: 520, portMinH: 560, portMaxH: 1000, refW: 390, refH: 844 },
    WORLD_W: 2000,               // 전장 전체 가로 길이(px). 화면보다 길어서 카메라가 좌우로 움직인다
    LANE_ROWS: [-136, -102, -68, -34, 0, 34, 68, 102, 136],   // 유닛이 서는 세로 줄 9개 (전투 줄 중심에서의 거리). 세로 전용 화면의 남는 높이를 써서 접촉면을 넓힌다 — 전에는 5줄 ±56
    PACK: { bands: 3, min: 3, max: 5 },   // 적은 3~5기씩 무리를 지어 위·가운데·아래 중 한 띠로 나온다 (무리마다 띠가 바뀐다) — 범위 마법을 어느 무리에 쓸지 고르게
    /* 아군 집결선: 아군은 적 기지까지 가지 않고 전장 가운데(x = WORLD_W × at)까지만 나아가 대열을 갖춘다 (디펜스라 적 건물을 칠 일이 없다, 2026-11-12).
       대열 = 세로 줄(rows) × 가로 열. 열 간격 col(px), 맨 앞 열이 집결선. 근접은 앞 열부터, 원거리는 ranged번째 열부터, 지원(공격 없는 유닛)은 support번째 열부터 빈자리를 맡는다.
       집결선에서 zone(px) 안에 들어오면 줄 서기 대신 자기 자리로 곧장 간다 */
    HOLD: { at: 0.5, col: 38, ranged: 1, support: 1, zone: 330, leash: 260 },   // leash = 근접 유닛이 집결선 너머로 적을 쫓아가는 한도(px). 적 원거리 유닛의 사거리(최대 224px)보다 길어야 한다 — 짧으면 사거리 밖에서 맞기만 한다
    UNIT_GAP: 30,                // 줄 서기: 같은 편 앞사람과 벌려 두는 간격(px)
    ROW_NEAR: 18,                // 세로로 이만큼 안이면 "같은 줄"로 본다
    /* 에워싸기(근접 유닛): 적이 engage(px) 안에 들어오면 줄을 풀고 그 적에게 바로 다가가 사방에서 친다.
       yScale = 세로 거리를 가로보다 얼마나 멀게 칠지(비스듬한 화면이라 세로가 눌려 보인다), personal = 같은 편끼리 벌리는 거리 */
    SURROUND: { engage: 220, yScale: 1.3, personal: 26, slots: 8, skipSec: 4, detour: 52, holdDist: 85 },   // holdDist = 나를 둘러싸러 오는 적이 이 거리 안에 왔을 때부터 제자리를 지킨다   // slots = 적 하나를 둘러싸는 자리 수, 자리가 다 차면 skipSec 동안 그 적을 두고 detour(px)만큼 비켜 돌아간다
    PASS_LOOK: 2.5,              // 앞지르기 미리 보기: 같은 줄 앞쪽 UNIT_GAP × 이 값 안에 나보다 느리게 걷는 같은 편이 있으면, 붙어서 멈추기 전에 걸어가면서 옆줄로 비켜 앞지른다 (0 = 끔)
    PASS_WAIT: 0.5,              // 앞사람에게 이만큼(초) 막혀 있으면 빈 옆줄로 추월을 시도한다
    ALT_MAX: 16,                 // 공중 유닛이 땅에서 떠 보이는 높이의 한도(px). 원본 그림은 엔젤 나이트가 100px 넘게 떠 있어 위쪽 표시를 가린다
    RANGE_SPREAD: 0.2,           // 원거리 유닛마다 서는 거리를 사거리의 (1 − 이 값)~1배 사이에서 다르게 (한 줄로 뭉치지 않게)
    CAM: { holdMs: 450, follow: 2.5, manualSec: 5, skillSec: 2.5, skillSpeed: 7 },   // skillSec = 내 마법을 쓴 뒤 그 지점을 비추는 시간(초), skillSpeed = 그리로 미끄러져 가는 빠르기   // 카메라: 전선을 따라가는 빠르기, 손으로 움직인 뒤 자동으로 돌아오기까지(초)
    BASE: { hp: 600, x: 134, front: 252 },   // 2026-11-13: x 78 → 150, front 196 → 268 — 성 그림 전체가 화면에 들어오게 오른쪽으로(전에는 왼쪽 일부가 잘려 수비대 자리가 안 보였다)
      // 아군 기지(성): 체력, 그림 기준점의 가로 위치, 성 앞 선(아군이 나오고 적이 멈춰 때리는 곳)
    LAIR: { back: 74, mouth: 150 },         // 적 출구(마굴): 그림 기준점이 화면 오른쪽 끝에서 떨어진 거리, 적이 나오는 입구까지의 거리
    MANA: { max: 300, start: 80, regen: 11, perWave: 0.8 },   // perWave: 웨이브가 하나 넘어갈 때마다 초당 회복 +0.8 (1웨이브 11 → 10웨이브 18.2). 적은 수·레벨·마법이 함께 느는데 아군 수입이 고정이라 8웨이브에서 꺾였다 (README 118, 2026-11-13)
      // 마나: 최대, 시작, 초당 회복. 처치 보상은 없앴다(2026-11-12) — 적을 잡으면 마나 대신 경험치를 얻는다. 그만큼 회복을 9 → 11
    /* 성장: 적을 쓰러뜨리면 전체 경험치(원작 유닛의 경험치 값, unitdata +0x2AE)가 쌓이고, 차면 게임이 멈추고 카드 3장 중 하나를 고른다.
         need(L) = base × grow^(L−1)  → 4, 6, 10, 16, 26, 42, 67, 107, 172 … (웨이브 전체 경험치 499로 9번쯤 오른다)
         lvStep = "전군 단련" 한 장에 오르는 유닛 레벨, hero = 영웅으로 나올 수 있는 유닛(원작에 영웅 지정 유닛은 없어 목업이 고름), heroLv·heroHp = 영웅의 추가 레벨·체력 배수 */
    /*   heroes = 영웅 카드로 나올 수 있는 원작 영웅(이름으로 data.heroes 에서 찾는다 — 미션 파일에서 뽑은 것, tools/herobuild.js, 분석 8-40).
           영웅 = 기본 유닛의 그림·행동 + 원작 영웅 기록의 이름·초상화·체력·공격·방어. 체력은 최소 기본 유닛의 heroHp배, 한도 heroCap (네메시스는 원작이 체력 10000·공격 1000이라 자른다).
           영웅의 마법은 패널에 올라오지 않고 영웅이 스스로 쓴다 — 마나 없이 heroCool(초)마다 */
    GROW: { heroFromWave: 5,   /* 영웅 카드는 이 웨이브(1부터)부터 나온다 — 초반에 영웅이 나오면 그 뒤가 너무 쉬워진다 (2026-11-13 사용자 요청: 중후반부터) */ xpFall: 0.08, xpMin: 0.3,   /* 웨이브가 진행될수록 같은 적을 잡아도 경험치를 덜 준다: 배수 = max(xpMin, 1 - xpFall × 지난 웨이브 수) → 1웨이브 100%, 5웨이브 68%, 10웨이브 30% (2026-11-12 사용자 요청) */ base: 4, grow: 1.6, lvStep: 2, heroes: ['파인트 롤', '레디쉬 앤', '벨리프 쇼링', '다인 바운터', '가웬 포라튼', '스카이 러너', '크리스 리디아', '폴로운', '네메시스 인트루더'],
            heroLv: 5, heroHp: 2, heroCap: { hp: 2500, atk: 80, def: 30 }, heroCool: 10, manaRegen: 2, manaMax: 40, dmg: 0.3, radius: 0.2, repair: 0.4 },
    ALLY_MOVE_MUL: 0.85,         // 아군만 걷는 속도를 한 단계 느리게 (적 기지에 너무 빨리 닿아서, 2026-11-12). 적은 그대로
    MOVE_SCALE: 0.45,            // 원본 걷기 속도(px/틱)를 이 게임 속도로 줄이는 배수
    RANGE_SCALE: 0.07,           // 원본 사거리 → 화면 px (근접 700 → 49px, 원거리 3000 → 210px)
    ENEMY_HP_MUL: 1.1,             // 적 체력 배수 (원본 해골전사는 체력 50이라 한 방에 쓰러진다)
    COST_PER_UP: 0.25,           // 전직 유닛의 추가 마나 = 그 유닛까지의 전직 비용(원본 upGold) 합 × 이 값. 원본에서 사제는 성령사(70금)를 뽑아 160금을 더 내고 전직한다 — 생산비만 보면 성령사 30 / 사제 35로 격차가 5뿐이었다 (2026-11-12 사용자 지적)
    COST_PER_GOLD: 0.45,         // 소환 마나 = 원본 생산 비용(금) × 이 값 (5 단위로 반올림)
    MAX_MAGIC: 0,                // 마법 유닛 동시 소환 한도
    /* 회수: 마법 유닛을 전장에서 거둬들여 자리를 비운다. 마나 환급 = 소환 값 × refund × 남은 체력 비율.
       confirmSec = 칩을 한 번 누른 뒤 "회수"로 바뀌어 있는 시간(이 안에 한 번 더 눌러야 회수), fxArm·snd = 사라질 때의 원본 이펙트 칸·소리(텔레포테이션) */
    RECALL: { refund: 0.5, confirmSec: 2, fxArm: 3, snd: 5018 },
    /* 성 배치 = 건물 원거리 공격 (원본 FUN_004d0a40 / FUN_004d1760 / FUN_004a69e0, 분석 8-35).
       등급(유닛 종류의 unitdata +0x2B2 — sim/defense.js 의 MW_DEF.units 에 구워 둠)별로:
         act   = 쏘는 원본 행동 번호 (4 활 쏘기, 15 파이어 볼)        mod·step = 사격 틱 조건: tick % mod == 자리 번호 × step
         deploy = 무기가 전개되는 틱 수 (그동안은 못 쏜다)             loop = 가동 중 되풀이하는 그림 수
       사거리 = (4000 + 건물 사거리 보정 × 10) × RANGE_SCALE,  피해 = 원본 피해 공식 + 성 안 유닛들의 건물 공격 보너스 합 */
    /* 벙커 (2026-11-13): 성과 전장 가운데 사이의 길목에 세운 원작 방어 건물 2개. 성처럼 눌러서 고른 동안 소환하면 그 안에 들어가 쏜다(원본 건물 사격 규칙 8-35).
       x = 건물 기준점의 가로 위치, cap = 수용 인원. 전투 줄을 막지 않게 맨 윗줄 위(up px)에 세운다. 부서지지 않고 적은 건드리지 않는다(1차 — 재미를 확인한 뒤 체력을 넣을지 정한다) */
    FORTS: [{ key: 'fort1', name: '타워', x: 470, cap: 4, hp: 500, at: 'top' }, { key: 'fort2', name: '방어기지', x: 730, cap: 4, hp: 500, at: 'bottom' }], FORT_UP: 20, FORT_DOWN: 30,
    /* 2026-11-13 2차: 벙커에 체력(hp). 유닛이 든 벙커는 적의 어그로를 끈다 — 위쪽 벙커는 전투 줄 위쪽 절반의 적, 아래쪽 벙커는 아래쪽 절반의 적이 지나가다 멈춰서 때린다(빈 벙커는 지나친다).
       체력이 0이 되면 부서지고 안의 유닛이 밖으로 나온다(그 판에서는 다시 못 쓴다). 수용 인원: 벙커 4명, 성 GAR_MAX(8)명 */   // at: 'top' = 맨 윗줄 위(FORT_UP px), 'bottom' = 전장 맨 아래(패널 위 FORT_DOWN px). 2026-11-13: 위 하나·아래 하나로 (사용자 요청) — 키 큰 타워가 위, 낮은 방어기지가 아래
    GAR_DEF_MIN: 0.3,            // 성 수비대의 방어 보너스로 피해를 줄여도 원래 피해의 이 비율은 받는다
    GAR_MAX: 8,                  // 성에 넣을 수 있는 수비 인원 (원본 성의 수용 인원 8보다 적게 — 사용자 요청)
    GARRISON: { tps: 12, shotSpeed: 420, classes: { 4: { act: 4, from: 4, mod: 24, step: 1, deploy: 5, loop: 16 }, 0: { act: 15, from: 12, mod: 40, step: 4, deploy: 10, loop: 10 } } },
    /* 아군 마법 유닛(스킬이 있는 유닛)은 공격 유닛에 바짝 붙는다 (2026-11-13 사용자 요청: 강화를 걸어 줄 유닛이 너무 뒤에 선다).
       rangeMul = 기본 공격 사거리에 곱하는 값(정령사·마법사·장로는 210px 밖에서 쏘며 서 있었다 → 약 115px), supportDist = 기본 공격이 없는 아군(성령사·사제·연금술사·공주)이 적과 두는 거리 */
    CASTER: { rangeMul: 0.55, supportDist: 110 },
    /* 자폭 (좀비, 원본 행동 39 — 자기 둘레 범위 피해를 주고 자신은 죽는다): 맞은편 유닛이 radius 안에 min 기 이상 붙었거나, 체력이 hp 비율 아래로 떨어졌는데 하나라도 붙어 있으면 터진다.
       멈춤(석화) 중에는 못 터진다 → 턴 언데드로 먼저 잡으면 막을 수 있다. 피해 = 원본 공식(k1 32·k2 26) × dmgMul. 2026-11-13 */
    BOOM: { radius: 62, min: 2, hp: 0.45, dmgMul: 1 },
    /* 아군 AI (2026-11-13 사용자 요청):
       ① 물러서기: 전장 가운데 집결선(frontX)을 pullOver px 넘게 넘어간 아군이 적 pullMin(2)기 이상에게 맞고 있으면 pullSec 초 동안 집결선 뒤로 돌아온다 — 전선을 뒤로 당긴다.
       ② 교대: 난전 중 체력이 coverHp(50%) 이하로 떨어진 근접 아군은 가까이(coverDist px 안) 있는 멀쩡한 근접 아군의 뒤(coverBack px)로 물러난다. 거기서도 적이 닿으면 싸운다. 회복해서 체력이 coverHp 를 넘으면 다시 앞으로 */
    AI: { pullOver: 10, pullMin: 2, pullSec: 1.5, coverHp: 0.5, coverDist: 150, coverBack: 34, engage: 130 },
    FLEE_SEC: 2.2, FLEE_SPEED: 1.3,   // 공격 없는 아군이 맞았을 때 물러나는 시간(초)과 걸음 배수 (2026-11-13 사용자 요청)
    SUPPORT_DIST: 210,           // 기본 공격이 없는 유닛(성직자·소환사 등)이 적과 벌려 두는 거리(px)
    /* friendlyFire: 범위 안의 아군(시전자 포함)도 같은 피해를 입는 마법 (2026-11-13 사용자 요청 — 가장 센 범위 마법이라 쓸 자리를 가려야 한다) */
    /* 스킬은 전체 마나를 쓴다 (소환과 같은 마나) + 짧은 재사용 대기 cool(초). 값 = 원본 행동 마나 × costMul 을 5 단위로, 종류별 [최소, 최대] 안으로 자른다 (COST)
       — 원본은 유닛마다 마나통이 따로라 값을 그대로 쓸 수 없어 비율만 가져온다. 2026-11-12: 쿨타임만 돌던 방식에서 바꿈 (공짜라 강화를 상시 돌리던 문제) */
    SKILL: { charmMax: 3, cool: 3, costMul: 0.4, COST: { blast: [40, 100], buff: [20, 30], heal: [25, 70], haste: [60, 60], dispel: [30, 40], weaken: [20, 25], stun: [35, 50], recall: [40, 40], charm: [50, 60], assassin: [40, 40], morph: [20, 20] }, radius: 95, buffRadius: 170, dmgMul: 2, healRatio: 0.35, healMax: 3, stunSec: 6, stunBase: 112, firstWait: 2, hasteMul: 1.5, maxCast: 320, walkSec: 45, buffSec: 7, buffMax: 2, summonRadius: 140, undeadDmg: { '턴 언데드': 80, '디스트로이 언홀리': 140 }, friendlyFire: { '12 리플렉터스 소환': 1 }, tierBase: 100, tierPer: 0.004 },   // maxCast = 시전 거리 한도(px). 원본 사거리가 무제한(65535)인 마법도 이 안에 대상이 있어야 한다   // 스킬 공통 수치 (목업 값)
    /* 소환 패널의 탭: 해방부대 전체(원본 유닛 번호 0~24)를 네 묶음으로 나눈다 */
    TABS: [
      { name: '근접', ids: [0, 1, 2, 3, 6, 7, 8] },          // 전사 기사 창기사 성기사 창검사 격투가 무도가
      { name: '원거리', ids: [4, 5, 9, 10, 22, 23] },        // 궁수 명궁 도사 의적 엔젤 나이트 엔트
      { name: '마법', ids: [11, 12, 13, 14, 15, 16] },       // 정령사 마법사 장로 연금술사 마법전사 마법기사
      { name: '신성·소환', ids: [17, 18, 19, 20, 21, 24] }   // 성령사 사제 주교 소환사 신수사 공주
    ],
    /* 마법 유닛과 마법은 표로 정하지 않는다: 원본 행동 중 "기본 공격이 아니고, 마나를 쓰고, 이 게임이 효과를 구현한(skillKind)" 것이
       그 유닛의 마법이고(skillsOf), 마법이 하나라도 있으면 마법 유닛이다. 아이콘·이펙트·소리·수치는 원본 행동 데이터 그대로. */
    MORPH: { 23: 77, 77: 23 },   // 변형 스킬로 오가는 유닛 번호 (엔트 ↔ 지상 엔트)
    /* 웨이브: list = [유닛 번호, 수] 묶음들(순서대로 나온다), gap = 한 기씩 나오는 간격(초), rest = 다음 웨이브까지 쉬는 시간(초)
       28 해골전사, 29 해골기사 */
    /* 적 마법: 적 마법 유닛(리치·다크로드·사탄·메두사·서큐버스·술사류)도 자기 마법을 스스로 쓴다 — 마나 없이 재사용 대기만.
       cool = 한 번 쓴 뒤 다시 쓰기까지(초), first = 나온 뒤 처음 쓰기까지 [최소, 최대](초). 난이도 조절용: 지금은 길게 둔다 */
    /* 기술(마법이 아닌 몸동작): 스킬 칸에 올리지 않고 유닛이 알아서 쓴다 — 마나 없이, 자기만의 재사용 대기(cool 초)로. 쓸 때 유닛 위에 이름이 떴다 사라진다.
       이름 = 원본 행동 이름. first = 나온 뒤 처음 쓰기까지(초). 2026-11-12 사용자 요청(암살). 후보: 창 돌리기·방패 막기·숨기·엔트 변형 (README 88) */
    /* 적 레벨: 웨이브가 진행될수록 적이 높은 레벨로 나온다 — 레벨 = start + perWave × (웨이브 − 1). 원본 성장 규칙 그대로 체력(+hpGrow)·공격(k1 × 레벨)·방어(defGrow × 레벨)가 함께 오른다.
       체력 배수만 올리는 것보다 낫다: 초반은 그대로 두고 후반만 어려워지며, "전군 단련"으로 오르는 아군 레벨과 짝이 맞는다 (2026-11-12 사용자 제안) */
    ENEMY_LV: { start: 1, perWave: 0.7 },   // 2026-11-13: 1 → 0.7 (10웨이브에 레벨 7). 1일 때 봇이 6~7웨이브에서 무너졌다 (README 105)
    SKILL_OFF: { '넨 소환': 1, '헤이스트': 1 },   // 헤이스트(마녀): 원작은 자기 전용인데 디펜스에서는 주변 적 전부가 60초 동안 공격 대기 없이 쳐서 흑마술파 8웨이브가 무너졌다 — 2026-11-13 사용자 결정으로 제외 (README 128)
      // 디펜스에서 뺀 마법 (원본 행동 이름). 넨 소환 = 아군 텔레포트(리콜): 2026-11-12 사용자 요청으로 제외 — 코드(recall)는 남겨 둔다
    TECH: { '암살': { cool: 20, first: 4 } },
    /* 몸동작 기술 (2026-11-13 사용자 지정): 마나 0 인 원본 행동이라 스킬 칸·TECH(마나를 쓰는 행동) 경로에 없다 — 아군 유닛이 조건이 되면 알아서 쓴다 (_bodyTech). SKILL_OFF 에 이름을 넣으면 꺼진다.
       방패 막기(전사·기사): 체력이 hpBelow(20%) 이하가 되면 켜져 방어 ×2 (원본 방패 막기의 방어 배수, rules.js). 싸움은 계속한다.
         푸는 조건(사용자 지정): 체력이 hpRelease(70%) 이상이고, 둘레 near(px) 안의 적이 foes(3)기 미만일 때 — 둘 다 맞아야 풀린다.
       창 돌리기(창검사): 둘레(원본 사거리 1200 → 84px)에 지상의 적이 foes(3)기 이상이면 한 바퀴 돌려 그 적 전부에게 원본 공식 피해, 원본대로 자기 체력 10 소모(1 밑으로는 안 내려감), 다시 쓰기까지 cool 초 */
    BODY_TECH: { '방패 막기': { hpBelow: 0.2, hpRelease: 0.7, foes: 3, near: 60 }, '창 돌리기': { foes: 3, cool: 8 } },
    ENEMY_SKILL: { on: false, fromWave: 8, cool: 30, first: [8, 16] },   // fromWave = 이 웨이브(1부터)부터는 on 이 꺼져 있어도 적이 마법을 쓴다 (2026-11-12 사용자 요청: 8·9·10)
      // on = 적이 마법을 쓰는가. 2026-11-12: 아군이 불리해 끔(사용자 요청). 켜면 cool·first 로 빈도 조절
    /* 웨이브: 악령군 전체가 섞여 나온다. [유닛 번호, 수]. 한 웨이브 안에서는 순서를 섞는다(_waveQueue).
       28 해골전사 29 해골기사 30 듀라한 32 유령 33 리치 34 다크로드 35 흡혈귀 36 늑대인간 38 메두사 39 데몬 40 데빌 41 사탄 42 서큐버스
       43 늑대 44 켈베로스 45 펜릴 46 박쥐(공중) 47 드래곤(공중) 48 디아블로 25 악령술사 26 강신술사 27 사술사
       31 좀비: 기본 공격 표시가 없는 '핸드 밤'으로 친다(basicAct 보정) — 2026-11-13 추가(웨이브 2·3·5·6·7·9, 해골전사 자리를 일부 대신). 도펠갱거 37은 공격이 없어 뺐다 */
    /* 웨이브 진행 (2026-11-13 절충안): 그 웨이브의 적이 다 나온 뒤, 쉬는 시간(rest)이 지났고 **남은 적이 left 기 이하**이면 다음 웨이브. 적을 못 줄여도 maxWait 초가 지나면 넘어간다. 전멸하면 바로.
       전에는 쉬는 시간만 지나면 무조건 넘어가서, 한 번 밀리면 웨이브가 겹쳐 60~80기가 쌓이고 그대로 끝났다 (README 103) */
    WAVE_PACE: { left: 10, maxWait: 40 },
    /* 적 종족 (2026-11-13): 시작 화면에서 고른다. name = 이름, lair = 출구 건물(MW_DEF 의 키), glow = 출구의 빛 색, fig = 시작 화면 버튼에 그릴 유닛, waves = 웨이브 표.
       고른 종족의 waves 가 CONFIG.WAVES 자리에 들어간다(setEnemy) — 진행·승리 판정은 CONFIG.WAVES 만 본다.
       흑마술파(진영 2, 유닛 49~71): 52 전사 53 흑전사 54 흑기사(근접) 55 도둑 56 대도 57 마기사 49 흑마술사 50 요마술사 51 대마술사 61 인챈터(원거리) 63 흡혈귀 64 늑대인간 68 개미 69 거미 70 전갈(근접)
       66 구렁이(사거리 긺) 67 드래곤(공중). 58 소환사·59 환술사·60 연금술사·62 마녀(공중)는 기본 공격이 없어 적 마법이 켜지는 8웨이브부터만 나온다.
       가고일 65(변형뿐)·왕자 71(감속 마법 — 디펜스에 아직 없는 종류)은 뺐다. 유닛 하나하나가 악령군보다 튼튼해서(전사 체력 150 : 해골전사 50) 수는 줄이고 웨이브별 체력 합을 악령군과 맞췄다(232기) */
    ENEMY_DEFAULT: 'evil',
    ENEMIES: {
      dark: { name: '흑마술파', lair: 'lair2', glow: '110,120,255', fig: 54, hpMul: 0.85, waves: [   // hpMul = 이 종족만의 체력 배수(ENEMY_HP_MUL 에 곱한다). 체력 합을 맞춰도 방어·원거리 비중이 높아 봇이 악령군보다 한 웨이브 일찍(8~9) 무너져서 0.85 (README 128)
        { list: [[52, 3], [55, 1]], gap: 2.2, rest: 6 },   // 2026-11-13 사용자 요청: 초반(1~3웨이브) 물량 1.4~2배 (2·4·7 → 4·7·10기), 간격은 줄여 웨이브 길이는 비슷하게
        { list: [[52, 3], [55, 2], [68, 2]], gap: 1.9, rest: 6 },
        { list: [[52, 4], [55, 3], [68, 2], [53, 1]], gap: 1.6, rest: 7 },
        { list: [[52, 5], [55, 3], [68, 2], [53, 2], [63, 1], [49, 2]], gap: 1.5, rest: 7 },
        { list: [[52, 5], [53, 4], [55, 3], [64, 3], [69, 2], [57, 2], [49, 2]], gap: 1.2, rest: 8 },
        { list: [[52, 6], [53, 4], [56, 2], [63, 3], [64, 1], [69, 2], [57, 2], [49, 2], [68, 4]], gap: 1.1, rest: 8 },
        { list: [[52, 6], [53, 5], [54, 1], [56, 3], [64, 3], [70, 1], [66, 1], [50, 2], [57, 2], [67, 1], [69, 2], [68, 2]], gap: 0.95, rest: 8 },
        { list: [[52, 8], [53, 5], [54, 2], [55, 4], [63, 3], [70, 2], [49, 3], [61, 2], [60, 1], [59, 1], [62, 3], [68, 4]], gap: 0.9, rest: 9 },
        { list: [[52, 8], [53, 7], [54, 3], [56, 4], [64, 4], [69, 3], [66, 2], [50, 3], [58, 2], [60, 2], [67, 2], [57, 3], [62, 3]], gap: 0.78, rest: 9 },
        { list: [[52, 9], [53, 7], [54, 4], [56, 4], [63, 3], [64, 3], [70, 3], [66, 2], [51, 2], [50, 2], [61, 3], [59, 2], [58, 1], [67, 4], [62, 3]], gap: 0.76, rest: 0 }
      ] },
      evil: { name: '악령군', lair: 'lair', glow: '190,90,220', fig: 30, waves: [   // 2026-11-12: 성장 시스템으로 너무 쉬워져 웨이브당 적 수를 늘리고(108 → 378기) 10단계로. 8·9·10 웨이브는 적도 마법을 쓴다 (ENEMY_SKILL.fromWave)
      { list: [[28, 9]], gap: 1.3, rest: 6 },   // 2026-11-13 사용자 요청: 초반(1~3웨이브)이 너무 쉬워 물량 약 1.5배 (6·10·15 → 9·15·21기), 간격은 줄여 웨이브 길이는 비슷하게
      { list: [[28, 8], [31, 3], [43, 4]], gap: 1.1, rest: 6 },
      { list: [[28, 9], [31, 3], [43, 4], [32, 4], [25, 1]], gap: 0.95, rest: 7 },
      { list: [[28, 11], [29, 4], [46, 6], [35, 2], [39, 4], [33, 1]], gap: 0.9, rest: 7 },
      { list: [[28, 8], [31, 3], [29, 6], [36, 4], [40, 4], [26, 1], [38, 1], [44, 2], [48, 2]], gap: 0.8, rest: 8 },
      { list: [[28, 11], [31, 3], [29, 6], [30, 4], [45, 4], [34, 1], [42, 1], [46, 6], [33, 2], [36, 4]], gap: 0.7, rest: 8 },
      { list: [[28, 10], [31, 4], [29, 8], [30, 4], [44, 4], [34, 2], [41, 1], [27, 1], [47, 1], [48, 4], [38, 1], [40, 6]], gap: 0.6, rest: 8 },
      { list: [[28, 14], [29, 8], [30, 6], [45, 4], [33, 4], [25, 2], [35, 4], [39, 6], [46, 6], [42, 2]], gap: 0.6, rest: 9 },
      { list: [[28, 13], [31, 4], [29, 10], [30, 6], [44, 4], [45, 4], [34, 4], [26, 2], [27, 2], [47, 2], [48, 6], [40, 6], [38, 2]], gap: 0.55, rest: 9 },
      { list: [[28, 17], [29, 11], [30, 8], [36, 6], [34, 4], [41, 2], [27, 2], [33, 4], [47, 4], [48, 7], [45, 6], [42, 2], [39, 6]], gap: 0.5, rest: 0 }
      ] }
    }
  };
  CONFIG.WAVES = CONFIG.ENEMIES[CONFIG.ENEMY_DEFAULT].waves;   // 지금 고른 적 종족의 웨이브 표 (setEnemy 가 바꾼다)

  /* ───────────────────────── 2. 준비 ───────────────────────── */
  function DefenseGame(canvas, data, opts) {
    this.cv = canvas; this.ctx = canvas.getContext('2d');
    this.data = data; this.cfg = CONFIG;
    this.H = 450; this.W = 800;

    // 원본 데이터 → 엔진 객체
    this.types = {}; var self = this;
    data.units.forEach(function (d) { self.types[d.id] = new MWE.UnitType(d); });   // 유닛 번호로 찾는다 (77 같은 변형 형태도 있다)
    this.rules = new MWE.OriginalRules(data.fx.arms);        // 원본 피해 공식
    this.rng = new MWE.Rng(Date.now() & 0xffff);
    this.enemy = CONFIG.ENEMY_DEFAULT; CONFIG.WAVES = CONFIG.ENEMIES[this.enemy].waves;   // 적 종족 (시작 화면에서 고른다 — setEnemy)
    this.map = new MWE.GameMap(data.map2);                   // 배경으로 쓸 원본 맵 (평지가 있는 2인용 맵)

    var parentOf = {}; data.units.forEach(function (d) { (d.up || []).forEach(function (x) { if (parentOf[x] == null) parentOf[x] = d.id; }); });   // 전직 대상 → 원래 유닛
    // 소환 목록: 탭마다 { 유닛 종류, 마나 값, 다시 소환까지(초), 마법 유닛인가 }
    this.roster = CONFIG.TABS.map(function (tab) { return tab.ids.map(function (id) {
      var t = self.types[id], cost = summonCost(self.types, parentOf, id);
      return { id: id, t: t, cost: cost, cd: Math.max(1, Math.min(8, cost / 20)), magic: skillsOf(t).some(function (a) { return !CONFIG.TECH[a.name]; }), tech: skillsOf(t).some(function (a) { return !!CONFIG.TECH[a.name]; }) || bodyTechs(t).length > 0, wait: 0, gar: garInfo(id) };
    }); });
    this.tab = 0;

    // 그림: 필요한 것만 불러온다 (배경 타일, 이펙트, 스킬 아이콘, 유닛 작은 그림, 건물, 쓰는 유닛의 스프라이트)
    var A = this.assets = new MWE.Assets(opts.base);
    A.load('tiles', this.map.keys.tiles + '.png').load('acticons', 'acticons.png').load('figs', 'figs.png').load('defense', 'defense.png').load('hpbar', 'hpbar.png').load('portraits', 'portraits.png').load('hud0', 'hud0.png').load('hudwin', 'hudwin.png');   // 원작 체력 바 틀·숫자, 초상화(영웅 카드) (bar.spr, helpnum.mwl → tools/hpbarbuild.js)
    this.bld = root.MW_DEF || {};                            // 건물 그림 위치표 { base, lair } (sim/defense.js)
    this._usedUnitIds().forEach(function (id) { A.load('u' + id, self.types[id].img); });
    // 이펙트 시트: 여러 장 중 이 게임이 쓰는 이펙트 칸의 것만 미리 받는다 (쓰는 유닛들의 모든 행동 + 순간이동·가속·회수 이펙트). 빠진 것이 있으면 그릴 때 그 장을 받는다 (_fxFrame)
    var armIds = { 3: 1, 21: 1, 44: 1 }; armIds[CONFIG.RECALL.fxArm] = 1;
    this._usedUnitIds().forEach(function (id) { self.types[id].acts.forEach(function (a) { if (a && a.arm >= 0) armIds[a.arm] = 1; }); });
    this.fxSheets = {}; Object.keys(armIds).forEach(function (k) { var d = data.fx.arms[k]; (d && d.sheets || []).forEach(function (n) { self._loadFxSheet(n); }); });
    this.terrain = null;                                     // 그림이 다 오면 만든다

    // 원작 영웅: 기본 유닛 종류를 물려받고 이름·초상화·수치만 영웅 기록의 것으로 바꾼 종류를 만든다
    this.heroDefs = [];
    (data.heroes || []).forEach(function (h) { if (CONFIG.GROW.heroes.indexOf(h.name) < 0) return; var base = self.types[h.type]; if (!base) return;
      var G = CONFIG.GROW, t = Object.create(base); t.name = h.name; t.job = base.name; t.pid = h.pid;
      t.hp = Math.min(G.heroCap.hp, Math.max(h.hp, base.hp * G.heroHp)); t.atk = Math.min(G.heroCap.atk, Math.max(h.atk, base.atk)); t.def = Math.min(G.heroCap.def, Math.max(h.def, base.def));
      t.lv = { max: base.lv.max, exp: base.lv.exp, hpGrow: Math.min(40, Math.max(h.hpGrow, base.lv.hpGrow)), mpGrow: base.lv.mpGrow, tbl: base.lv.tbl };
      self.heroDefs.push({ name: h.name, t: t, base: base, rec: h }); });
    this.recallIcon = -1;                                    // 회수 팻말에 그릴 원작 리콜 아이콘 (넨 소환의 아이콘 번호)
    data.units.forEach(function (d) { (d.acts || []).forEach(function (a) { if (a && a.sup === 'recall' && a.icon >= 0 && self.recallIcon < 0) self.recallIcon = a.icon; }); });
    this.sfx = new MWE.Sfx(opts.base + 'sfx.js', data.sfx);
    this.bgm = new MWE.Bgm(opts.base, [['bgm0.mp3', 'bgm0b.mp3', 'bgm0c.mp3'], ['bgm1.mp3', 'bgm1b.mp3', 'bgm1c.mp3'], ['bgm2.mp3', 'bgm2b.mp3', 'bgm2c.mp3']]);
    this.soundOn = false; this.sfx.on = false;   // 소리는 꺼진 채로 시작한다 (오른쪽 위 [무음]을 누르면 켜짐). 2026-11-12 사용자 요청

    this.screen = 'loading';     // loading(불러오는 중) → title(시작 화면) → play(진행) → win / lose
    this.time = 0; this._last = 0;
    this._resize(); this._bind(); this.reset();
    requestAnimationFrame(function loop(ts) { requestAnimationFrame(loop); self._frame(ts); });
  }
  var P = DefenseGame.prototype;
  /* 수비 건물(성 + 벙커)은 this.forts 에 있다: { key, name, B(건물 그림 정보), x, y(기준점), cap, garrison[], weapons{} }. 고른 건물 = this.selFort.
     예전 코드가 쓰던 selBase·garrison·weapons 는 "지금 고른 건물(없으면 성)"을 가리키는 이름으로 남긴다 */
  P._fort = function () { return this.selFort || (this.forts && this.forts[0]) || { garrison: [], weapons: { 0: { phase: -1, c: 0 }, 4: { phase: -1, c: 0 } }, cap: 0 }; };
  Object.defineProperty(P, 'selBase', { get: function () { return !!this.selFort; }, set: function (v) { this.selFort = v ? (this.selFort || (this.forts && this.forts[0]) || null) : null; } });
  Object.defineProperty(P, 'garrison', { get: function () { return this._fort().garrison; }, set: function (v) { this._fort().garrison = v; } });
  Object.defineProperty(P, 'weapons', { get: function () { return this._fort().weapons; }, set: function (v) { this._fort().weapons = v; } });
  P._garAll = function () { var L = []; (this.forts || []).forEach(function (f) { L = L.concat(f.garrison); }); return L; };
  P._capAll = function () { return (this.forts || []).reduce(function (n, f) { return n + f.cap; }, 0); };

  /* 이 게임이 화면에 올리는 유닛 번호 전부 (소환 목록 + 변형 형태 + 웨이브에 나오는 적) */
  P._usedUnitIds = function () {
    var ids = {}, C = CONFIG;
    C.TABS.forEach(function (tab) { tab.ids.forEach(function (id) { ids[id] = 1; }); });
    Object.keys(C.MORPH).forEach(function (id) { ids[id] = 1; });
    C.WAVES.forEach(function (w) { w.list.forEach(function (e) { ids[e[0]] = 1; }); });
    return Object.keys(ids).map(Number);
  };

  /* 게임 안 크기(W × H)를 화면에 맞춰 정한다 (CONFIG.SCREEN 설명 참고).
     실제 화면에 꽉 채우는 것은 CSS(object-fit: contain)가 한다 — 여기서는 "게임 안 좌표"만 정한다. */
  P._resize = function () {
    var r = this.cv.getBoundingClientRect(), vw = r.width || root.innerWidth || 800, vh = r.height || root.innerHeight || 450, C = CONFIG, S = C.SCREEN;
    var clamp = function (v, a, b) { return Math.max(a, Math.min(b, Math.round(v))); };
    this.port = true;                                        // 늘 세로 배치 (가로 화면이어도 바뀌지 않는다)
    if (vh > vw * 1.05) { this.W = clamp(vw / S.portZoom, S.portMinW, S.portMaxW); this.H = clamp(this.W * vh / vw, S.portMinH, S.portMaxH); }   // 세로 화면: 화면 비율대로
    else { this.W = S.refW; this.H = S.refH; }                // 가로 화면·PC: 기준 크기 고정, CSS가 가운데에 세워 놓는다
    this.cv.width = this.W; this.cv.height = this.H;
    this.ctx.imageSmoothingEnabled = false;                  // 도트 그림이 뭉개지지 않게 (크기를 바꾸면 다시 켜지므로 매번 끈다)
    this._layout();                                          // 아래 패널 높이(hudH)가 여기서 정해진다
    var fieldH = this.H - this.hudH, half = C.LANE_ROWS[C.LANE_ROWS.length - 1];
    this.laneY = Math.round(fieldH * 0.66);                  // 전투 줄의 세로 중심 (위쪽 표시와 겹치지 않게 조금 아래)
    var rk = Math.max(0.4, Math.min(1, (this.laneY - 130) / half, (fieldH - this.laneY - 14) / half));   // 화면이 낮으면 줄 간격을 줄인다: 맨 윗줄 유닛 머리가 위쪽 표시 밑에, 맨 아랫줄이 패널 위에 남도록
    this.rows = C.LANE_ROWS.map(function (v) { return Math.round(v * rk); });   // 유닛이 서는 세로 줄 (전투 줄 중심에서의 거리)
    this.spawnX = C.WORLD_W - C.LAIR.mouth;                  // 적이 나오는 곳 (마굴 입구) — 전장 좌표
    this.frontX = Math.round(C.WORLD_W * C.HOLD.at);         // 아군이 나아가는 한계 = 집결선 (전장 가운데)
    this.cam = this.cam || { x: 0 };                         // 카메라: 화면 왼쪽 끝이 전장의 어디인가
    this._clampCam();
  };

  /* 버튼 배치. 모든 버튼은 { x, y, w, h } 상자이고, 그리기·누르기 코드는 상자만 본다 — 배치를 바꾸려면 이 함수만 고치면 된다.
       세로 전용: 아래 패널 = [탭 5칸] → [소환 버튼 한 줄 캐러셀 ◀ 4칸 ▶] → [마법 유닛 칩 + ◀▶] → [스킬 칸 4개] → 하단 여유. 전장을 넓게 남기면서 터치 타깃은 44px 이상.
     위쪽 표시(기지·마나·수비 / 웨이브 / 진행 막대 / 소리)는 왼쪽 상자 오른쪽에 웨이브와 진행 막대를 붙인다 (가로가 좁으므로) */
  var SAFE = { top: 20, bottom: 24 };   // 게임 안쪽 여유(px): 위쪽 표시가 상태 표시줄 밑에 바싹 붙지 않게, 아래 마지막 줄이 iOS 홈 막대 스와이프 영역과 겹치지 않게 (safe-area 자체는 CSS가 뺀다)
  P._layout = function () {
    var C = CONFIG, W = this.W, H = this.H, n = C.MAX_MAGIC, most = Math.max.apply(null, C.TABS.map(function (t) { return t.ids.length; })), i, y0, lx = 8;
    {
      // 세로: [탭 5칸 26] → [소환 버튼 한 줄 64: ◀ 4칸 ▶ 캐러셀] → [마법 유닛 칩 + 마법 N + ◀▶ 22] → [스킬 칸 4개 62] → 하단 여유 24  = 214 (390×844 에서 전장 630)
      var per = 4, g = 6, aw2 = 24, bh = 64, tabH = 26, ch = 22, sh = 62;
      this.slotsVis = 4; this.btnVis = per; this.hudH = 6 + tabH + 4 + bh + 4 + ch + 2 + sh + SAFE.bottom; y0 = H - this.hudH;
      var tw = Math.floor((W - 16 - (C.TABS.length - 1) * 4) / C.TABS.length);   // 탭이 줄 전체를 쓴다 (2026-11-13: [성 N/4] 버튼 삭제 — 성은 전장에서 직접 누른다)
      this.tabBoxes = C.TABS.map(function (t, k) { return { x: lx + k * (tw + 4), y: y0 + 6, w: tw, h: tabH }; });
      // 소환 줄: 양 끝에 넘김 화살표(24×64), 그 사이에 보이는 4칸. 탭에 유닛이 더 있으면 끌거나 화살표로 넘긴다 (btnFirst)
      var by = y0 + 6 + tabH + 4, ax = lx + aw2 + 2, bw = Math.floor((W - 16 - (aw2 + 2) * 2 - (per - 1) * g) / per);
      this.btnPrev = { x: lx, y: by, w: aw2, h: bh }; this.btnNext = { x: W - 8 - aw2, y: by, w: aw2, h: bh };
      this.btnStep = bw + g; this.btnArea = { x: ax, y: by, w: per * bw + (per - 1) * g, h: bh };
      this.btnBoxes = []; for (i = 0; i < per; i++) this.btnBoxes.push({ x: ax + i * (bw + g), y: by, w: bw, h: bh });
      // 칩 줄: 마법 유닛 칩(32×22, 선택·카메라 이동용) + "마법 N" + 스킬 캐러셀 ◀▶
      var hy = by + bh + 4, sy = hy + ch + 2, sw = Math.floor((W - 16 - (this.slotsVis - 1) * g) / this.slotsVis);
      this.skillPanel = { x: lx, y: hy, w: W - 16, h: ch };
      this.chipBoxes = [];   // 마법 유닛 칩은 없앴다 (한도 폐지 — 유닛은 전장에서 직접 눌러 고른다)
      this.slotPrev = { x: W - 8 - 70, y: hy, w: 33, h: ch }; this.slotNext = { x: W - 8 - 33, y: hy, w: 33, h: ch };
      this.slotStep = sw + g; this.slotArea = { x: lx, y: sy, w: W - 16, h: sh };
      this.slotBoxes = []; for (i = 0; i < this.slotsVis; i++) this.slotBoxes.push({ x: lx + i * (sw + g), y: sy, w: sw, h: sh });
    }
    // 위쪽 표시 (y = SAFE.top)
    var ty = SAFE.top; this.narrow = true;
    this.topBox = { x: 8, y: ty, w: 168 };
    this.soundBtn = { x: W - 44, y: ty, w: 36, h: 26 };
    this.affBtn = { x: W - 84, y: ty, w: 36, h: 26 };          // [상성] 버튼: 유닛 상성 모달 (소리 버튼 왼쪽)
    var wx = this.topBox.x + this.topBox.w + 6; this.waveBox = { x: wx, y: ty, w: W - 84 - 4 - wx, h: 26 }; this.miniBox = { x: wx + 4, y: ty + 32, w: W - 12 - (wx + 4), h: 14 };   // 진행 막대: 전장 전체를 한 줄로
    this._scrollBtns(0);                                     // 화면이 바뀌면 소환 캐러셀 위치를 범위 안으로
  };

  /* ───────────────────────── 3. 한 판 ───────────────────────── */
  P.reset = function () {
    var C = CONFIG;
    this.units = [];             // 전장 위의 모든 유닛 (아군·적)
    this.slots = [];             // 스킬 칸(SkillSlot) — 전장의 마법 유닛이 가진 마법마다 하나 (만든 순서)
    this.slotView = [];          // (= this.groups) 패널에 보이는 칸 = 마법 종류별 묶음, 처음 생긴 순서
    this.magicUnits = [];        // 전장의 마법 유닛 (패널에 칸이 있는 마법을 가진 아군)
    this.aim = null;             // 지점 지정 대기: { slot } — 적에게 쓰는 마법의 칸을 누른 상태. 전장을 누르면 그 지점에 쓴다
    this.aimPt = null;           // 조준 중 손가락·마우스가 가리키는 화면 좌표 (반경 원을 미리 보여 준다)
    this.sel = null;             // 전장에서 고른 아군 마법 유닛 (머리 위에 [회수] 버튼이 뜬다). 상태이지 상자가 아니다 — 매 프레임 자리를 다시 계산
    this.btnFirst = 0;           // 소환 캐러셀(세로 모드): 맨 왼쪽에 보이는 칸 번호
    this.recallArm = null;       // (이전 두 번 누르기 회수의 흔적 — 지금은 쓰지 않는다)
    this.selBase = false;        // 성을 골랐는가. 고른 동안에는 소환 버튼이 유닛을 전장 대신 성에 넣고(성 배치), 수비대가 있으면 [퇴각] 팻말이 뜬다.
                                 // 2026-11-13: 따로 있던 [성 배치] 토글(garOn)을 없애고 성 선택으로 합쳤다 — 켜 둔 줄 모르고 계속 성에만 넣는 일을 막는다
    // 수비 건물: 성(자리 0) + 벙커. garrison = 안의 유닛 { r(소환 목록 항목), u(피해 계산용 Unit), cls, bonus } — 순서 = 자리 번호. weapons = 건물 무기 상태(phase -1 없음 / 0 전개 중 / 2 가동, c = 그림 카운터)
    var D0 = this.bld, self0 = this, mk = function (key, name, B, x, yOf, cap) { var f = { key: key, name: name, B: B, x: x, cap: cap, garrison: [], weapons: { 0: { phase: -1, c: 0 }, 4: { phase: -1, c: 0 } }, isFort: key !== 'base', hp: 0, maxHp: 0, dead: false, hit: 0 }; Object.defineProperty(f, 'y', { get: yOf }); return f; };   // y 는 그때그때 계산 (화면 크기가 바뀌면 전투 줄 위치가 바뀐다)
    this.forts = []; if (D0.base) this.forts.push(mk('base', '성', D0.base, C.BASE.x, function () { return self0.laneY + 44; }, Math.min(C.GAR_MAX, D0.base.cap)));
    for (var fi = 0; fi < C.FORTS.length; fi++) { var fc = C.FORTS[fi]; if (D0[fc.key]) (function (fc) { var f = mk(fc.key, fc.name, D0[fc.key], fc.x, fc.at === 'bottom' ? function () { return self0.H - self0.hudH - C.FORT_DOWN; } : function () { return self0.laneY + self0.rows[0] - C.FORT_UP; }, Math.min(fc.cap, D0[fc.key].cap)); f.at = fc.at; f.hp = f.maxHp = fc.hp; self0.forts.push(f); })(fc); }
    this.selFort = null; this.modal = null; this.modalT = 0;
    this.garTick = 0;            // 마지막으로 처리한 사격 틱
    this.slotFirst = 0; this.slotPos = 0; this.slotView = []; this.groups = [];   // 캐러셀: 맨 왼쪽에 보이는 칸 번호, 넘기는 동작용 현재 위치
    this.shots = [];             // 날아가는 발사체
    this.effects = [];           // 터지는 이펙트
    this.texts = [];             // 떠오르는 숫자·글자 (피해량 등)
    this.baseHp = C.BASE.hp; this.baseHit = 0;
    this.mana = C.MANA.start; this.manaMax = C.MANA.max; this.manaRegen = C.MANA.regen;
    this.xp = 0; this.plv = 1; this.allyLv = 0; this.dmgUp = 0; this.radiusUp = 0; this.cards = null; this.cardT = 0; this.pendingLv = 0;   // 성장: 경험치·플레이어 레벨·아군 추가 레벨·마법 강화, 고르는 중인 카드
    this.roster.forEach(function (list) { list.forEach(function (r) { r.wait = 0; }); });   // 소환 버튼별 남은 대기 시간
    this.flash = 0;
    this.cam.x = 0; this.manualUntil = 0; this.drag = null; this.camGoal = null;
    this.pack = null;            // 지금 나오는 적 무리 { band(0 위·1 가운데·2 아래), left(남은 수) }
    this.seenFoes = {}; this.banner = null;   // 웨이브 알림: 지금까지 나온 적 종류, 화면 가운데에 잠깐 뜨는 알림 { wave, t0, fresh:[유닛 종류] }
    this.wave = 0; this.queue = this._waveQueue(0); this._announce(0); this.spawnT = 2; this.restT = 0; this.kills = 0;
  };

  /* 웨이브 한 개를 "나올 순서대로의 유닛 번호 목록"으로 편다. [[28,2],[29,1]] → [28,28,29] */
  P._waveQueue = function (i) {
    var q = [], w = CONFIG.WAVES[i]; if (!w) return q;
    w.list.forEach(function (e) { for (var k = 0; k < e[1]; k++) q.push(e[0]); });
    for (var j = q.length - 1; j > 0; j--) { var r = Math.floor(this.rng.next() * (j + 1)), t = q[j]; q[j] = q[r]; q[r] = t; }   // 섞는다 — 종류가 뒤섞여 나오게
    return q;
  };

  /* 그 종류의 "기본 공격" 행동. 공격 행동(isAtk)이 없는 유닛(성직자·소환사 등)은 null → 싸우지 않고 뒤에서 스킬만 쓴다 */
  /* 이 유닛이 성에 들어가면 하는 일: { cls: 건물 무기 등급(-1 = 쏘지는 못함), bonus: 건물 공격 보너스 }. 둘 다 없으면 null (배치 불가).
     등급은 이 게임이 구현한 것(CONFIG.GARRISON.classes: 0 마법사·장로, 4 궁수·명궁·창검사)만 인정한다 */
  /* 소환 마나: 원본 생산비(금) × COST_PER_GOLD, 전직 유닛은 뿌리 유닛 생산비 + 전직 사슬의 upGold 합 × COST_PER_UP (둘 중 큰 값, 5 단위, 최소 15).
     types = { 유닛 번호: UnitType 또는 data.units 항목 }, parentOf = { 전직 대상: 원래 유닛 }. 명세 생성기(tools/specbuild.js)도 이 함수를 쓴다 */
  function summonCost(types, parentOf, id) {
    var t = types[id], top = id, upSum = 0, guard = 0; while (parentOf[top] != null && guard++ < 6) { upSum += types[top].upGold || 0; top = parentOf[top]; }   // 전직 사슬을 거슬러 올라간다 (사제 ← 성령사)
    return Math.max(15, Math.round(t.cost[3] * CONFIG.COST_PER_GOLD / 5) * 5, Math.round((types[top].cost[3] * CONFIG.COST_PER_GOLD + upSum * CONFIG.COST_PER_UP) / 5) * 5);
  }
  function garInfo(id) {
    var d = root.MW_DEF && root.MW_DEF.units && root.MW_DEF.units[id]; if (!d) return null;
    var cls = CONFIG.GARRISON.classes[d.cls] ? d.cls : -1;
    return cls >= 0 || d.bonus > 0 || d.def > 0 ? { cls: cls, bonus: d.bonus, def: d.def || 0 } : null;   // def = 건물 방어 보너스 (원본 unitdata +0x2B6: 전사·기사 계열)
  }

  /* 그 종류가 가진 몸동작 기술 (CONFIG.BODY_TECH 에 있고 꺼지지 않은 원본 행동) */
  function bodyTechs(t) { return t.acts.filter(function (a) { return a && CONFIG.BODY_TECH[a.name] && !CONFIG.SKILL_OFF[a.name]; }); }
  function basicAct(t) { var a = t.ai >= 0 ? t.acts[t.ai] : null; return a && (a.isAtk == 1 || (a.dmg && !a.suicide && !a.mana && !a.aoe)) ? a : null; }   // 좀비의 핸드 밤처럼 '공격' 표시는 없지만 마나 없이 치는 단일 피해 행동도 기본 공격으로 본다

  /* 적이 나올 줄 번호: 지금 무리(pack)의 띠 안에서 고른다. 무리가 다 나오면 다른 띠로 새 무리를 시작한다 */
  P._packRow = function () {
    var K = CONFIG.PACK, n = this.rows.length, per = Math.max(1, Math.floor(n / K.bands)), p = this.pack;
    if (!p || p.left <= 0) { var b = Math.floor(this.rng.next() * K.bands); if (p && b === p.band) b = (b + 1) % K.bands;
      p = this.pack = { band: b, left: K.min + Math.floor(this.rng.next() * (K.max - K.min + 1)) }; }
    p.left--;
    return Math.min(n - 1, p.band * per + Math.floor(this.rng.next() * per));
  };

  /* 유닛 한 기를 전장에 올린다. side: 0 아군(왼쪽에서 오른쪽으로), 1 적(오른쪽에서 왼쪽으로) */
  P.spawn = function (typeId, side) {
    var C = CONFIG, t = this.types[typeId], u = new MWE.Unit(t, side, 0, 0), self = this;
    u.side = side;
    u.x = side === 0 ? C.BASE.front - 8 : this.spawnX;
    u.y = this.laneY + this.rows[side === 1 ? this._packRow() : Math.floor(this.rng.next() * this.rows.length)];
    if (side === 1) { this._setLevel(u, Math.max(1, Math.round(C.ENEMY_LV.start + C.ENEMY_LV.perWave * Math.min(this.wave, C.WAVES.length - 1)))); u.maxHp = Math.round(u.maxHp * C.ENEMY_HP_MUL * (C.ENEMIES[this.enemy].hpMul || 1)); u.hp = u.maxHp; }
    u.state = 'move'; u.cd = 0; u.fade = 0; u.stunUntil = 0; u.blockT = 0; u.passY = null;
    u.rangeK = 1 - C.RANGE_SPREAD * this.rng.next();         // 이 유닛이 서는 거리 배수 (원거리만 쓴다)
    u.lookDir = 0; u.slotOf = null; u.slotA = null; u.slotAt = null; u.slotT = 0; u.apT = -9; u.skipUid = null; u.skipUntil = 0; this._setSide(u, side);
    this._applyType(u);
    if (side === 0 && this.allyLv) this._setLevel(u, 1 + this.allyLv);   // "전군 단련"으로 오른 만큼 높은 레벨로 나온다
    // 마법 유닛이면 가진 마법마다 스킬 칸을 만들어 서로 가리키게 한다 (유닛 하나 ↔ 칸 여러 개)
    u.spawnId = typeId;                                      // 소환 버튼의 유닛 번호 (변형해도 그대로 — 회수 환급 계산용)
    u.slots = []; u.castSkill = function (i) { return self.castUnitSkill(u, i || 0); };
    if (side === 0) { skillsOf(t).forEach(function (a) { self._addSlot(u, a); }); if (u.slots.some(function (q) { return !q.auto; })) this.magicUnits.push(u); this._regroup(); }
    else {                                                   // 적 마법 유닛: 칸은 유닛만 갖고(패널에는 안 나옴) 스스로 쓴다 (_enemyMagic). 변형은 이 게임에서 대응 형태가 없어 뺀다
      var E = C.ENEMY_SKILL; u.auto = true;
      if (E.on || this.wave + 1 >= E.fromWave) skillsOf(t).forEach(function (a) { var q = new SkillSlot(u, a); if (q.kind === 'morph') return; q.cdMax = E.cool; q.cd = E.first[0] + self.rng.next() * (E.first[1] - E.first[0]); q.cost = 0; u.slots.push(q); }); }
    this.units.push(u);
    return u;
  };

  /* 편(진영)과 걷는 방향을 정한다. 매혹으로 편이 바뀔 때도 쓴다.
     스프라이트 방향: 원본은 마름모 좌표라 "화면 오른쪽"이 (1,-1), "화면 왼쪽"이 (-1,1)이다 */
  P._setSide = function (u, side) { u.hold = null; u.side = side; u.fac = side; u.dir = side === 0 ? 1 : -1; u.oct = null; this._look(u, u.dir); u.tgt = null; };

  /* 종류에서 나오는 값(기본 공격·사거리·속도)을 유닛에 다시 적는다. 처음 소환할 때와 변형할 때 */
  P._applyType = function (u) {
    var C = CONFIG, t = u.t;
    // 떠 있는 높이: 원본 스프라이트는 공중 유닛의 고도가 그림 안에 이미 들어 있다(발밑 기준점보다 그림 아랫변이 위에 있음).
    // 그 높이가 ALT_MAX를 넘으면 넘는 만큼 그림을 내려 그린다(drop). headY = 발밑에서 머리 꼭대기까지 — 체력 바·글자·발사체 위치의 기준
    var f0 = t.frames[t.anim.idle[u.row]] || t.frames[0], lift = f0 ? Math.max(0, f0[5] - f0[3]) : 0;
    u.drop = Math.max(0, lift - C.ALT_MAX);
    u.headY = (f0 ? Math.max(t.h, f0[5]) : t.h) - u.drop;
    u.air = t.fly === 2;                                     // 공중 유닛(엔젤 나이트): 줄 서기 없이 아군 위를 지나간다 — 원본도 공중 유닛은 충돌이 없다
    u.act = basicAct(t);
    u.boom = t.acts.filter(function (a) { return a.suicide && a.dmg; })[0] || null;   // 자폭 행동이 있는 유닛(좀비)
    u.rangePx = (u.act ? u.act.range : 0) * C.RANGE_SCALE; if (u.act && u.rangePx < 36) u.rangePx = 36;   // 핸드 밤(사거리 100 → 7px)처럼 너무 짧으면 닿을 수 없다 → 근접 최소 거리
    if (u.rangePx >= 80) u.rangePx *= u.rangeK;              // 원거리: 유닛마다 조금씩 다른 거리에서 멈춘다
    var caster = u.side === 0 && !u.hero && skillsOf(t).length > 0;
    if (caster && u.rangePx >= 80) u.rangePx = Math.max(80, u.rangePx * C.CASTER.rangeMul);   // 아군 마법 유닛은 앞줄 가까이에서 쏜다
    u.supDist = caster ? C.CASTER.supportDist : C.SUPPORT_DIST;
    // reach = "적에게 얼마나 가까이 가려는가". 줄 서기에서 reach가 짧은 유닛(근접)은 긴 유닛(원거리·지원)을 지나쳐 앞으로 나간다
    u.reach = u.act ? u.rangePx : u.supDist;
    u.speedPx = t.walkPx * this.rules.tps * C.MOVE_SCALE * (u.side === 0 ? C.ALLY_MOVE_MUL : 1);    // 초당 이동 px (소환할 때의 편 기준 — 매혹으로 편이 바뀌어도 그대로)
  };

  /* 소환 검증: 지금 이 버튼으로 소환할 수 있는가. 안 되면 이유를 돌려준다 ('' = 가능)
       'max'  마법 유닛이 이미 한도만큼 전장에 있음
       'mana' 마나 부족      'wait' 다시 소환까지 대기 중
       'nogar' 성에 배치할 수 없는 유닛      'full' 성이 가득 참  (둘은 [성 배치]가 켜져 있을 때만) */
  P.canSummon = function (r) {
    if (this.selBase) {                                      // 성을 고른 동안(성 배치): 배치할 수 있는 유닛만, 성의 수용 인원까지. 마법 유닛 한도와는 무관
      if (!r.gar) return 'nogar';
      if (this.garrison.length >= this.garCap()) return 'full';
      return this.mana < r.cost ? 'mana' : r.wait > 0 ? 'wait' : '';
    }
    if (CONFIG.MAX_MAGIC > 0 && r.magic && this.magicCount() >= CONFIG.MAX_MAGIC) return 'max';   // MAX_MAGIC = 0: 한도 없음 (2026-11-12 폐지)
    if (this.mana < r.cost) return 'mana';
    if (r.wait > 0) return 'wait';
    return '';
  };

  /* 전장에 살아 있는 마법 유닛 수 (쓰러지면 바로 목록에서 빠진다) */
  P.magicCount = function () { return this.magicUnits.length; };

  /* 지금 탭의 i번째 소환 버튼을 누름 */
  P.summon = function (i) {
    var r = this.roster[this.tab][i]; if (!r || this.screen !== 'play') return false;
    var why = this.canSummon(r);
    if (why) { var msg = why === 'max' ? '마법 유닛은 ' + CONFIG.MAX_MAGIC + '기까지' : why === 'nogar' ? '건물에 배치할 수 없는 유닛' : why === 'castle' ? '방어 보너스 유닛은 성에만 배치' : why === 'full' ? '성이 가득 찼습니다' : '';
      if (msg) this._say(this.cam.x + this.W / 2, this.laneY - 120, msg, '#ffb36a'); return false; }
    this.mana -= r.cost; r.wait = r.cd;
    if (this.selBase) { this._garrison(r); return true; }
    var u = this.spawn(r.id, 0);
    this._play(u.t.snd.ready, 0.8);                          // 원본 등장 음성
    return true;
  };

  /* ───────────────────────── 3-2. 성 배치 (건물 원거리 공격) ───────────────────────── */
  /* 성의 수용 인원 (BuildingData +0x10: 성 8) */
  /* 지금의 초당 마나 회복: 기본(+ "마나의 샘" 카드) + 웨이브마다 perWave */
  P.regenNow = function () { return this.manaRegen + CONFIG.MANA.perWave * Math.min(this.wave, CONFIG.WAVES.length - 1); };
  P.garCap = function (f) { return (f || this._fort()).cap; };   // 원본 성은 8명이지만 디펜스는 GAR_MAX(4)명까지 (2026-11-13)
  /* 성 안 유닛들의 건물 공격 보너스 합 (원본 건물 +0x30 = Σ unitdata +0x2B4) */
  P.garBonus = function (f) { return (f || this._fort()).garrison.reduce(function (n, m) { return n + m.bonus; }, 0); };
  /* 성의 사거리(px): 원본 4000 + BuildingData[+0x1C] × 10 (0.1px 단위) → 이 게임 배수로 */
  /* 건물 방어 보너스 합 (원본 unitdata +0x2B6 — 전사·기사 계열이 건물에 들어가면 방어가 오른다, 분석 8-42). 디펜스에서는 성이 받는 피해에서 뺀다 (_hitBase) */
  P.garDef = function (f) { return (f || this._fort()).garrison.reduce(function (n, m) { return n + (m.def || 0); }, 0); };
  P.garRange = function (f) { return (4000 + (f || this._fort()).B.rangeAdd * 10) * CONFIG.RANGE_SCALE; };

  /* 유닛을 성에 넣는다. 무기 등급이 있는 유닛이 처음 들어오면 그 등급의 무기가 전개되기 시작한다 */
  P._garrison = function (r) {
    var G = CONFIG.GARRISON, g = r.gar, u = new MWE.Unit(r.t, 0, 0, 0), k = G.classes[g.cls];
    if (k) { u.act = this.types[k.from].acts.filter(function (a) { return a.id === k.act; })[0]; var w = this.weapons[g.cls]; if (w.phase < 0) { w.phase = 0; w.c = 0; } }   // 건물에서는 등급의 행동으로 쏜다 (명궁·창검사도 활 쏘기)
    this.garrison.push({ r: r, u: u, cls: g.cls, bonus: g.bonus, def: g.def || 0 });
    this._play(r.t.snd.ready, 0.8);
    var F = this._fort(), o = this._bldOrigin(F.B, F.x, F.y);
    this._say(o[0] + F.B.center[0], Math.min(F.y, this.laneY) - 150, r.t.name + ' ' + F.name + ' 배치' + (g.bonus ? '  (사격 +' + g.bonus + ')' : '') + (g.def ? '  (방어 +' + g.def + ')' : ''), '#ffe9b0');
  };
  function C_BASE_X() { return CONFIG.BASE.x; }

  /* 매 틱(초당 12): 무기 그림 카운터를 넘기고, 자리 번호에 맞는 틱에 사격한다.
       전개(phase 0): deploy 틱 동안 솟아오르는 그림, 그동안은 쏘지 않는다 → 가동(phase 2): loop 장을 되풀이
       사격: 자리 i의 유닛은 tick % mod == i × step 일 때, 성 중심에서 사거리 안의 가장 가까운 적(지상·공중)에게 */
  P._updateGarrison = function () {
    var G = CONFIG.GARRISON, tick = Math.floor(this.time * G.tps), self = this; if (!this.forts || !this.forts.length) return;
    if (tick - this.garTick > 6) this.garTick = tick - 6;    // 탭이 오래 멈췄다 돌아왔을 때 몰아서 쏘지 않게
    while (this.garTick < tick) {
      var t = ++this.garTick;
      this.forts.forEach(function (F) {                      // 성과 벙커마다 따로: 무기 그림, 자리 번호, 사거리, 보너스
        [0, 4].forEach(function (cls) { var w = F.weapons[cls], k = G.classes[cls]; if (w.phase < 0) return;
          w.c++; if (w.phase === 0 && w.c >= k.deploy) { w.phase = 2; w.c = 0; } else if (w.phase === 2) w.c %= k.loop; });
        if (!F.garrison.some(function (m) { return m.cls >= 0; })) return;
        var B = F.B, o = self._bldOrigin(B, F.x, F.y), cx = o[0] + B.center[0], range = self.garRange(F), bonus = self.garBonus(F);
        for (var i = 0; i < F.garrison.length; i++) { var m = F.garrison[i], k2 = G.classes[m.cls]; if (!k2 || F.weapons[m.cls].phase !== 2 || t % k2.mod !== (i * k2.step) % k2.mod) continue;
          var tgt = null, bd = range, L = self.units;
          for (var j = 0; j < L.length; j++) { var e = L[j]; if (e.side !== 1 || e.state === 'dead') continue; var d = Math.abs(e.x - cx); if (d <= bd) { bd = d; tgt = e; } }
          if (!tgt) continue;
          var act = m.u.act, pos = B['arm' + m.cls], def = self.data.fx.arms[act.arm];
          self.shots.push({ x: o[0] + pos[0], y: o[1] + pos[1] - 24, tgt: tgt, dmg: self.rules.damage(m.u, tgt, self.rng) + bonus, arm: act.arm, def: def, dir: 1, t0: self.time, speed: G.shotSpeed });
          self._play(act.snd, 0.35);
        }
      });
    }
  };

  /* ───────────────────────── 4. 스킬 ───────────────────────── */
  /* SkillSlot: 오른쪽 스킬 패널의 한 칸 = 마법 유닛 한 기의 마법 하나.
       slot.unit → 그 유닛,  unit.slots → 그 유닛의 칸들 (유닛 하나에 마법이 여럿일 수 있다)
     this.slots의 순서가 패널에서의 순서다(소환한 순서대로, 한 유닛의 마법은 붙어서). 칸마다 쿨타임이 따로 돈다. */
  function SkillSlot(unit, act) {
    this.unit = unit; this.act = act;
    this.cdMax = CONFIG.SKILL.cool;                          // 재사용 대기(초): 짧게 — 몰아 쓰기만 막는다. 실제 제한은 마나 값(cost)
    this.cd = CONFIG.SKILL.firstWait;                        // 소환 직후 잠깐은 못 쓴다
    this.readyAt = 0;                                        // 쿨타임이 끝난 시각 (패널에서 앞에 설 순서를 정한다)
    this.vi = null;                                          // 패널에서 지금 그려지는 자리 (순서가 바뀌면 그 자리로 미끄러져 간다)
    this.kind = skillKind(act);
    this.aimed = this.needsFoe() || this.kind === 'recall' || this.kind === 'haste' || this.kind === 'dispel' || act.sup === 'massheal';   // 지점을 찍는 마법: 적에게 쓰는 것, 리콜, 그리고 넓은 범위의 소환 마법(말다 소환 = 범위 회복, 케멘 소환 = 범위 가속 — 2026-11-13 사용자 요청, 원본도 땅을 찍는 마법). 강화·힐링은 누르면 바로   // 리콜도 불러올 곳을 찍는다                            // 적에게 쓰는 마법은 누르면 바로 나가지 않고 전장에서 지점을 찍는다 (아군·자기에게 쓰는 마법은 즉시)
    var lim = CONFIG.SKILL.COST[this.kind] || [20, 60];
    this.cost = Math.max(lim[0], Math.min(lim[1], Math.round(act.mana * CONFIG.SKILL.costMul / 5) * 5));   // 쓸 때 드는 마나
  }
  SkillSlot.prototype.ready = function () { return this.cd <= 0 && this.unit.state !== 'dead'; };
  /* 적이 있어야 쓰는 마법인가 (범위 공격·약화·멈춤·매혹·암살). 아니면 아군에게 쓰는 마법(회복·강화·가속)이거나 자기에게 쓰는 것(변형) */
  SkillSlot.prototype.needsFoe = function () { return { blast: 1, weaken: 1, stun: 1, charm: 1, assassin: 1 }[this.kind] === 1; };
  SkillSlot.prototype.needsAlly = function () { return { heal: 1, buff: 1, haste: 1 }[this.kind] === 1; };

  /* 원본 행동 → 이 게임에서의 스킬 종류 (null = 아직 구현하지 않은 행동: 텔레포테이션·천리안·숨기·술 소환 등) */
  function skillKind(a) {
    if (a.dmg) return 'blast';                                         // 범위 피해
    if (a.sup === 'heal' || a.sup === 'massheal') return 'heal';       // 아군 회복
    if (a.sup === 'weapon' || a.sup === 'shield') return 'buff';       // 아군 공격·방어 강화
    if (a.sup === 'haste' || a.sup === 'masshaste') return 'haste';    // 아군 가속
    if (a.sup === 'meltw' || a.sup === 'melta') return 'weaken';       // 적 공격·방어 약화
    if (a.sup === 'stone') return 'stun';                              // 적 멈춤
    if (a.sup === 'charm') return 'charm';                             // 적을 우리 편으로
    if (a.sup === 'assassin') return 'assassin';                       // 적 하나 즉사
    if (a.sup === 'morph') return 'morph';                             // 변형
    if (a.sup === 'massdispel') return 'dispel';                       // 강화 해제: 찍은 곳 둘레의 적 강화를 지우고 아군 약화·멈춤을 푼다 (술 소환)
    if (a.sup === 'recall') return 'recall';                           // 리콜: 찍은 곳 주변의 아군을 시전자 곁으로 (넨 소환)
    return null;
  }
  var KIND_NAME = { blast: '범위 공격', heal: '회복', buff: '강화', haste: '가속', weaken: '약화', stun: '적 멈춤', charm: '매혹', assassin: '암살', morph: '변형', recall: '리콜', dispel: '강화 해제' };

  /* 범위 공격 마법의 등급 배수 (2026-11-13): 원본 마나 소모가 큰 상위 마법일수록 세다 — 1 + (원본 마나 − tierBase) × tierPer, 1 밑으로는 안 내려간다.
     라이트닝 썬더(100) ×1.0, 나르 소환(150) ×1.2, 홀리 크로스(180) ×1.32, 12 리플렉터스 소환(250) ×1.6. 전에는 등급과 무관하게 피해가 비슷해 비싼 마법 유닛을 뽑을 이유가 약했다. 아군만 */
  function blastTier(a) { var S = CONFIG.SKILL; return Math.max(1, 1 + ((a.mana || 0) - S.tierBase) * S.tierPer); }
  /* 멈춤(석화) 시간(초): 기본 stunSec. 종족을 가리는 석화 마법은 원본 지속의 비율을 따른다 — 턴 언데드 112틱을 기준(stunSec 6초)으로 디스트로이 언홀리 160틱 → 약 8.6초.
     원본 그대로(9.3초 / 13.3초)는 너무 길어 비율만 가져왔다 (2026-11-13 사용자 선택) */
  function stunSecOf(a) { var S = CONFIG.SKILL; return a.races && a.dur ? +(S.stunSec * a.dur / S.stunBase).toFixed(1) : S.stunSec; }
  /* 그 종류가 가진 마법 목록: 기본 공격이 아니고, 마나를 쓰고(방패 막기 같은 몸동작 제외), 효과를 구현한 행동 */
  function skillsOf(t) { return t.acts.filter(function (a) { return a.isAtk != 1 && a.mana > 0 && skillKind(a) && !CONFIG.SKILL_OFF[a.name]; }); }

  /* 스킬 칸의 구조 (2026-11-12 "스킬 종류별 묶음"으로 바꿈, 마법 유닛 3기 한도 폐지):
       SkillSlot  = 유닛 한 기가 가진 마법 하나 (자기만의 재사용 대기 cd). this.slots = 전장의 모든 SkillSlot
       묶음(group) = 같은 마법을 가진 SkillSlot 들 { act, kind, aimed, cost, slots[] }. **패널의 칸 하나 = 묶음 하나** ("라이트닝 썬더 ×3").
                    칸을 누르면 그 마법을 가진 유닛 중 준비된 한 기가 쓴다. this.groups = 처음 생긴 순서(자리가 바뀌지 않는다)
       자기에게만 거는 강화(a.self: 아이스 웨폰 등)는 묶음에 넣지 않는다 — 유닛이 알아서, 마나 없이 쓴다 (s.auto, _selfMagic) */
  P._addSlot = function (u, act) { var s = new SkillSlot(u, act), tech = CONFIG.TECH[act.name]; if (act.self) { s.auto = true; s.cost = 0; }
    if (tech) { s.auto = true; s.tech = true; s.cost = 0; s.cdMax = tech.cool; s.cd = tech.first; }   // 기술: 알아서, 마나 없이, 자기 쿨타임으로 (_selfMagic)
    u.slots.push(s); this.slots.push(s); this._regroup(); return s; };

  /* 유닛이 쓰러지거나 회수될 때 그 유닛의 칸을 모두 뺀다. 그 마법을 가진 유닛이 더 없으면 패널의 칸(묶음)도 사라진다 */
  P._removeSlots = function (u) {
    if (!u.slots || !u.slots.length) return;
    this.slots = this.slots.filter(function (s) { return s.unit !== u; });
    u.slots.forEach(function (s) { s.unit = null; }); u.slots = [];
    var k = this.magicUnits.indexOf(u); if (k >= 0) this.magicUnits.splice(k, 1);
    this._regroup(); this.scrollSlots(0);
  };

  /* 묶음을 다시 만든다. 이미 있던 묶음 객체는 그대로 써서 패널에서의 자리와 미끄러지는 위치(vi)가 유지된다 */
  P._regroup = function () {
    var map = {}, out = [], old = this.groups || [], i;
    for (i = 0; i < old.length; i++) { old[i].slots = []; map[old[i].act.id] = old[i]; }
    for (i = 0; i < this.slots.length; i++) { var s = this.slots[i]; if (s.auto || !s.unit || s.unit.side !== 0 || s.unit.state === 'dead') continue;
      var g = map[s.act.id]; if (!g) { g = map[s.act.id] = { act: s.act, kind: s.kind, aimed: s.aimed, cost: s.cost, slots: [], vi: null, isNew: true }; }
      g.slots.push(s); }
    for (i = 0; i < old.length; i++) if (old[i].slots.length) out.push(old[i]);
    Object.keys(map).forEach(function (k) { if (map[k].isNew) { delete map[k].isNew; out.push(map[k]); } });
    this.groups = out; this.slotView = out;
  };
  P._sortSlots = function () { this._regroup(); };

  /* 쿨타임 처리: 모든 칸의 남은 시간을 줄인다. 캐러셀이 넘어가는 동작도 여기서 진행 */
  P._updateSlots = function (dt) {
    for (var i = 0; i < this.slots.length; i++) { var s = this.slots[i]; if (s.cd > 0) { s.cd = Math.max(0, s.cd - dt); if (s.cd === 0) s.readyAt = this.time; } }
    this._regroup();
    for (i = 0; i < this.groups.length; i++) { var v = this.groups[i]; v.vi = v.vi == null ? i : v.vi + (i - v.vi) * Math.min(1, dt * 10); }   // 앞의 칸이 사라지면 뒤의 칸이 미끄러져 온다
    this.slotPos += (this.slotFirst - this.slotPos) * Math.min(1, dt * 14);
  };

  /* 스스로 쓰는 마법 (s.auto, 마나 없음):
       ① 자기 강화(아이스 웨폰 등): 적이 가까이 왔고 그 강화가 걸려 있지 않을 때
       ② 영웅의 마법: 재사용 대기(heroCool)가 끝나고 쓸 만한 상황일 때 — 범위 공격·멈춤 등은 시전 거리 안에 적이 있을 때 가장 가까운 적에게,
          회복은 주변에 다친 아군이 있을 때, 강화·가속은 적이 다가왔고 주변에 그 효과가 없는 아군이 있을 때. 리콜·변형은 쓰지 않는다 */
  P._selfMagic = function () {
    var S = CONFIG.SKILL, T = this.time, L = this.units, self = this;
    for (var i = 0; i < this.slots.length; i++) { var s = this.slots[i], u = s.unit; if (!s.auto || !u || u.side !== 0 || u.state === 'dead' || s.cd > 0 || u.stunUntil > T) continue;
      var f = this._nearestFoe(u), fd = f ? Math.abs(f.x - u.x) : Infinity, key = s.act.sup === 'masshaste' ? 'haste' : s.act.sup;
      if (s.act.self) { var b = u.buffs[key]; if ((b && b.until > T) || fd > 300) continue; this.castUnitSkill(u, u.slots.indexOf(s)); continue; }
      if (s.kind === 'recall' || s.kind === 'morph' || s.kind === 'dispel' || !this.skillTarget(u, s)) continue;
      var near = function (r, test) { return L.some(function (o) { return o.side === 0 && o.state !== 'dead' && Math.abs(o.x - u.x) <= r && test(o); }); };
      if (s.kind === 'heal' && !near(S.buffRadius, function (o) { return o.hp < o.maxHp * 0.7; })) continue;
      if ((s.kind === 'buff' || s.kind === 'haste') && (fd > 320 || !near(S.buffRadius, function (o) { return !(o.buffs[key] && o.buffs[key].until > T); }))) continue;
      if (!this.castUnitSkill(u, u.slots.indexOf(s))) s.cd = 2; }
  };

  /* 캐러셀을 d칸 넘긴다 (음수 = 왼쪽). 범위를 벗어나지 않게 맞춘다 */
  P.scrollSlots = function (d) { this.slotFirst = Math.max(0, Math.min(Math.max(0, (this.groups || []).length - this.slotsVis), this.slotFirst + d)); };

  /* 묶음에서 지금 쓸 수 있는 칸들: 재사용 대기가 끝났고 시전자가 멈춰 있지 않다 */
  P._readyOf = function (g) { var T = this.time; return g.slots.filter(function (s) { return s.cd <= 0 && s.unit && s.unit.state !== 'dead' && !(s.unit.stunUntil > T) && !s.unit.castOrder; }); };   // 마법을 쓰러 걸어가는 중인 유닛(castOrder)은 뺀다
  /* 이 묶음을 지금 못 쓰는 이유 [문구, 색, 글자를 띄울 유닛]. 쓸 수 있으면 null */
  P._whyNot = function (g) {
    var self = this, any = g.slots[0] && g.slots[0].unit, R = this._readyOf(g);
    if (!R.length) { var cd = Math.min.apply(null, g.slots.map(function (s) { return s.cd > 0 ? s.cd : 99; })); return [cd < 99 ? '쿨타임 ' + Math.ceil(cd) : '멈춤 중', '#c9d1e3', any]; }
    if (this.mana < g.cost) return ['마나 부족 (' + g.cost + ')', '#e0584a', R[0].unit];
    if (!g.aimed && !R.some(function (s) { return self.skillTarget(s.unit, s); })) return [g.slots[0].needsFoe() ? '가까이에 적이 없음' : '가까이에 아군이 없음', '#c9d1e3', R[0].unit];
    return null;
  };
  /* 패널의 칸(묶음)을 누름. 적에게 쓰는 마법·리콜은 조준 상태로, 나머지(강화·회복·가속·변형)는 준비된 유닛 한 기가 바로 쓴다 */
  P.pressGroup = function (g) {
    var was = (this.aim && this.aim.group) || this._aimWas, self = this; this.aim = null; this._aimWas = null;
    if (!g || this.screen !== 'play') return false;
    this.selBase = false;                                    // 마법을 쓰려 하면 성 선택은 풀린다 (단축키로 눌렀을 때도)
    if (g.aimed && was === g) return false;                  // 조준 중인 칸을 다시 누르면 취소
    var why = this._whyNot(g); if (why) { if (why[2]) this._say(why[2].x, why[2].y - why[2].headY - 10, why[0], why[1]); return false; }
    var R = this._readyOf(g);
    if (!g.aimed) {                                          // 즉시 쓰는 마법: 주변에 효과를 받을 아군이 가장 많은 유닛이 쓴다
      var best = null, bn = -1; R.forEach(function (s) { if (!self.skillTarget(s.unit, s)) return; var n = self.units.filter(function (o) { return o.side === 0 && o.state !== 'dead' && Math.abs(o.x - s.unit.x) <= CONFIG.SKILL.buffRadius && (s.kind !== 'heal' || o.hp < o.maxHp) && !(s.kind === 'buff' && o.buffs[s.act.sup] && o.buffs[s.act.sup].until > self.time); }).length; if (n > bn) { bn = n; best = s; } });
      return !!best && this.castUnitSkill(best.unit, best.unit.slots.indexOf(best));
    }
    this.aim = { group: g }; this.sel = null; this.aimPt = null;
    var cx = this.cam.x + this.W / 2, near = R.slice().sort(function (a, b) { return Math.abs(a.unit.x - cx) - Math.abs(b.unit.x - cx); })[0];   // 화면에 가까운 시전자와 그 앞쪽이 보이게
    this.camGoal = { x: near.unit.x - this.W / 2 + Math.min(this.W * 0.3, this.aimReach(near) * 0.5), until: this.time + 1.2 }; this.manualUntil = 0;
    return true;
  };
  /* 지점 지정 마법의 시전 거리(px): 시전자에서 이 가로 거리 안의 지점만 찍을 수 있다 */
  P.aimReach = function (s) { return s.kind === 'recall' ? CONFIG.WORLD_W : Math.min(CONFIG.SKILL.maxCast, s.act.range * CONFIG.RANGE_SCALE); };   // 리콜은 원본처럼 거리 제한 없음
  /* 지점 지정 마법의 효과 반경(px) — 그리기와 판정이 같은 값을 쓴다 */
  P.aimRadius = function (s) { var S = CONFIG.SKILL, k = 1 + (this.radiusUp || 0); return s.kind === 'haste' || s.kind === 'dispel' || s.act.sup === 'massheal' ? S.summonRadius : s.kind === 'buff' ? 22 : s.kind === 'recall' ? 120 : s.kind === 'blast' ? (s.act.aoe ? S.radius * k : 60) : s.kind === 'charm' ? S.radius * 0.7 : s.kind === 'assassin' ? 45 : S.radius * k; };   // radiusUp = "마법 확산" 카드
  /* 조준 중 전장을 눌렀다 (2026-11-12 "걸어가서 쓰기"로 바꿈): 찍은 곳에 가장 가까운 준비된 유닛이 쓴다.
     시전 거리 안이면 바로, 밖이면 **닿는 곳까지 걸어가서** 쓴다(u.castOrder → _castWalk). 시전 거리 제한으로 못 찍는 곳은 없다 —
     다만 유닛은 전장 가운데(집결선 frontX)를 넘어 적 진영으로 들어가지 못하므로, 가운데에서도 닿지 않는 곳(frontX + 시전 거리 너머)은 찍을 수 없다 */
  P.aimLimit = function (g) { var self = this, m = 0; g.slots.forEach(function (s) { m = Math.max(m, self.aimReach(s)); }); return this.frontX + m; };
  P._aimCast = function (wx, wy) {
    var g = this.aim.group, self = this, R = this._readyOf(g); if (!g.slots.length) { this.aim = null; return false; }
    var Rw = this.rows, y = Math.max(this.laneY + Rw[0] - 30, Math.min(this.laneY + Rw[Rw.length - 1] + 10, wy));
    if (!R.length) { this._say(wx, y - 12, '쿨타임', '#e08a6a'); return false; }
    var s = R.slice().sort(function (a, b) { return Math.abs(wx - a.unit.x) - Math.abs(wx - b.unit.x); })[0], u = s.unit;
    if (wx > this.frontX + this.aimReach(s)) { this._say(wx, y - 12, '적 진영 안쪽 — 닿지 않음', '#e08a6a'); return false; }
    if (Math.abs(wx - u.x) <= this.aimReach(s)) { var ok = this.castUnitSkill(u, u.slots.indexOf(s), { x: wx, y: y }); if (ok) { this.aim = null; this.aimPt = null; } return ok; }
    var foe = null, bd = 45; if (s.kind === 'assassin') this.units.forEach(function (o) { if (o.side === u.side || o.state === 'dead') return; var d = Math.hypot(o.x - wx, o.y - y); if (d < bd) { bd = d; foe = o; } });   // 암살류는 그 적을 따라간다
    u.castOrder = { slot: s, x: wx, y: y, foe: foe, until: this.time + CONFIG.SKILL.walkSec };
    this._say(u.x, u.y - u.headY - 10, g.act.name + ' 쓰러 이동', '#7fd6ff');
    this.aim = null; this.aimPt = null; return true;
  };
  /* 마법을 쓰러 걸어가는 유닛 한 걸음. 닿으면 쓰고 명령을 지운다. 못 쓰게 됐으면(쿨타임·시간 초과·대상 사라짐) 그만둔다. true = 이번 프레임은 이 행동만 */
  P._castWalk = function (u, dt) {
    var o = u.castOrder, s = o.slot, k = u.slots.indexOf(s);
    if (k < 0 || s.cd > 0 || this.time > o.until || (o.foe && o.foe.state === 'dead')) { u.castOrder = null; return false; }
    if (o.foe) { o.x = Math.min(o.foe.x, this.frontX + this.aimReach(s)); o.y = o.foe.y - (s.kind === 'buff' ? o.foe.headY * 0.5 : 0); }   // 강화는 아군 몸통을 찍은 것으로
    var reach = this.aimReach(s), dx = o.x - u.x;
    if (Math.abs(dx) <= reach) { u.castOrder = null; this.castUnitSkill(u, k, { x: o.x, y: o.y }); return true; }
    var dest = Math.min(this.frontX, o.x - (dx > 0 ? 1 : -1) * (reach - 6)), mv = dest - u.x, step = Math.min(Math.abs(mv), this._speed(u) * dt);
    if (step < 0.01) { u.castOrder = null; return false; }
    u.x += (mv > 0 ? 1 : -1) * step; u.state = 'move'; u.walkT += dt; this._faceVec(u, mv, 0);
    u.slotOf = null; u.slotA = null; u.passY = null;
    return true;
  };
  /* 지금 보이는 칸 중 k번째를 누름 — 단축키 A·S·D·F */
  P.pressVisible = function (k) { return this.pressGroup(this.groups[this.slotFirst + k]); };
  P.pressSlot = function (i) { var s = this.slots[i]; if (!s) return false; var g = this.groups.filter(function (q) { return q.slots.indexOf(s) >= 0; })[0]; return g ? this.pressGroup(g) : false; };   // (이전 이름 — 유닛의 칸이 속한 묶음을 누른다)

  /* 소환 캐러셀(세로 모드)을 d칸 넘긴다. 가로 모드는 전부 보이므로 늘 0 */
  P._scrollBtns = function (d) { var n = this.roster ? this.roster[this.tab].length : 0, vis = this.btnVis || n; this.btnFirst = Math.max(0, Math.min(Math.max(0, n - vis), (this.btnFirst || 0) + d)); };
  /* (x, y)에 있는 소환 버튼의 목록 번호 (보이는 칸 k → btnFirst + k). 없으면 -1 */
  P.btnIndexAt = function (x, y) { var vis = this.btnVis || this.btnBoxes.length, list = this.roster[this.tab]; for (var k = 0; k < vis && k < this.btnBoxes.length; k++) if (inBox(this.btnBoxes[k], x, y)) { var i = (this.btnFirst || 0) + k; return i < list.length ? i : -1; } return -1; };

  /* 회수할 수 있는 유닛인가: 살아 있는 아군 마법 유닛 (magicUnits와 같은 기준) */
  P._recallable = function (u) { return !!(u && u.side === 0 && u.slots && u.slots.length && u.state !== 'dead'); };
  /* 유닛을 고른다: 선택 표시 + 머리 위 [회수] 버튼, 그 유닛의 마법이 스킬 칸 맨 앞에 보이게 */
  P._selectUnit = function (u) {
    this.sel = u; if (!u) return;
    var view = this.groups, idx = u.slots.map(function (q) { for (var k = 0; k < view.length; k++) if (view[k].slots.indexOf(q) >= 0) return k; return -1; }).filter(function (k) { return k >= 0; });
    if (idx.length) { this.slotFirst = Math.min.apply(null, idx); this.scrollSlots(0); }
  };
  /* 회수 때 돌려받는 마나 — 버튼 라벨과 실제 반환량이 같은 값이 되도록 한 곳에서 */
  P._refundOf = function (u) {
    var r = null; this.roster.forEach(function (list) { list.forEach(function (q) { if (q.id === u.spawnId) r = q; }); });
    return r ? Math.round(r.cost * CONFIG.RECALL.refund * u.hp / u.maxHp) : 0;
  };
  /* 선택한 유닛 머리 위 [회수] 버튼의 화면 상자 (그리기와 누르기가 같은 함수를 본다). 터치 타깃 64×44, 화면 가장자리·위쪽 표시·아래 패널을 피한다 */
  P._recallBtnBox = function (u) {
    var w = 74, h = 44, sx = Math.round(u.x - this.cam.x), x = Math.max(6, Math.min(this.W - 6 - w, sx - w / 2));
    var topY = Math.max(this.topBox.y + this._topH(), this.miniBox.y + this.miniBox.h) + 4;
    var y = Math.max(topY, Math.min(this.H - this.hudH - 6 - h, Math.round(u.y - u.headY) - h - 8));
    return { x: x, y: y, w: w, h: h };
  };
  /* 성(아군 기지)의 화면 상자와, 성을 골랐을 때 그 위에 뜨는 [퇴각] 팻말의 상자 */
  P._baseBox = function (f) { var F = f || this._fort(), B = F.B; if (!B) return null; var p = this.bld.pics[B.pic], o = this._bldOrigin(B, F.x, F.y); return { x: o[0] - p[4] - this.cam.x, y: o[1] - p[5], w: p[2], h: p[3], cx: o[0] + B.center[0] - this.cam.x }; };   // _pic 은 (o − 그림 원점)에 그린다
  P._retreatBox = function () {
    var bb = this._baseBox(), w = 62, h = 24; if (!bb) return null;   // 작게, 건물 위쪽 바깥에 (전에는 74×44가 건물 위에 겹쳐 건물을 가렸다 — 2026-11-13). 누르는 범위는 _tapField 에서 넉넉하게
    var topY = Math.max(this.topBox.y + this._topH(), this.miniBox.y + this.miniBox.h) + 34;   // 건물 선택 안내 줄 아래
    return { x: Math.max(6, Math.min(this.W - 6 - w, Math.round(bb.cx - w / 2))), y: Math.max(topY, Math.round(bb.y) - h - 8), w: w, h: h, tx: bb.cx, small: true };
  };
  /* 성을 고른다/푼다. 고르면 카메라가 성으로 가고, 고른 동안 소환 버튼은 성 배치로 동작한다 */
  P.selectBase = function (on) { this.selectFort(on ? this.forts[0] : null); };
  /* 수비 건물(성·벙커)을 고른다/푼다 (f = null 이면 풀기). 고르면 카메라가 그 건물로 가고, 고른 동안 소환 버튼은 그 건물 배치로 동작한다 */
  P.selectFort = function (f) {
    this.selFort = f || null; if (!f) return;
    this.sel = null; this.aim = null; this.aimPt = null;
    this.camGoal = { x: f === this.forts[0] ? 0 : f.x - this.W / 2, until: this.time + 1.5 }; this.manualUntil = 0;
  };
  /* 퇴각: 성 안의 수비대가 모두 성 밖으로 나와 전장 유닛이 된다 (마나는 들지 않는다). 성의 무기는 접힌다 */
  P.retreat = function () {
    var self = this, n = this.garrison.length; if (!n) return false;
    var F = this._fort();
    this.garrison.forEach(function (m) { var u = self.spawn(m.r.id, 0); if (F !== self.forts[0]) u.x = F.x + 20; });   // 벙커에서 나온 유닛은 그 벙커 앞에서 걷기 시작한다
    this.garrison = []; this.weapons = { 0: { phase: -1, c: 0 }, 4: { phase: -1, c: 0 } };
    var bb = this._baseBox(); this._say(bb.cx + this.cam.x, Math.min(F.y, this.laneY) - 150, F.name + ' 수비대 퇴각 (' + n + '기)', '#ffe9b0'); this._play(CONFIG.RECALL.snd, 0.8);
    return true;
  };
  /* 전장을 끌지 않고 눌렀다(탭). 우선순위: ① 선택 유닛의 [회수] 버튼 → 회수  ② 아군 마법 유닛 몸통 → 선택  ③ 일반 아군 → 안내만  ④ 빈 곳 → 선택 해제 */
  P._tapField = function (x, y) {
    if (this.screen !== 'play') return;
    if (this.aim) { this._aimCast(x + this.cam.x, y); return; }   // 조준 중: 누른 지점에 마법
    var rb0 = this.selBase && this.garrison.length ? this._retreatBox() : null;
    if (rb0 && inBox({ x: rb0.x - 8, y: rb0.y - 10, w: rb0.w + 16, h: rb0.h + 20 }, x, y)) { this.retreat(); this.selBase = false; return; }   // 팻말은 작지만 누르는 범위는 손가락에 맞게 넓다   // 성을 고른 뒤 [퇴각] 팻말
    var sel = this.sel; if (sel && this._recallable(sel) && inBox(this._recallBtnBox(sel), x, y)) { this.recall(sel); this.sel = null; return; }
    var wx = x + this.cam.x, best = null, bd = Infinity, plain = null, L = this.units, i, u, d;
    for (i = 0; i < L.length; i++) { u = L[i]; if (u.side !== 0 || u.state === 'dead') continue;
      if (Math.abs(u.x - wx) <= 20 && y >= u.y - u.headY - 6 && y <= u.y + 8) { d = Math.hypot(u.x - wx, (u.y - y) * 1.6);
        if (this._recallable(u)) { if (d < bd) { bd = d; best = u; } } else if (!plain) plain = u; } }
    if (best) { this.selBase = false; this._selectUnit(best); return; }
    this.sel = null;
    if (!plain) for (var fi = this.forts.length - 1; fi >= 0; fi--) { var F = this.forts[fi], bb = F.dead ? null : this._baseBox(F); if (bb && inBox(bb, x, y)) { this.selectFort(this.selFort === F ? null : F); return; } }   // 성·벙커를 누름: 고르기/풀기 (벙커 먼저 — 성 그림이 넓다)
    this.selBase = false;
    if (plain) this._say(wx, y - 12, '마법 유닛만 회수할 수 있습니다', '#c9d1e3');
  };

  /* 마법 유닛 칩 i를 누름 = 그 유닛을 선택하고 카메라를 그쪽으로, 스킬 칸도 그 유닛의 마법으로. (회수는 전장의 [회수] 버튼으로) */
  P.pressChip = function (i) {
    var u = this.magicUnits[i]; if (!u || this.screen !== 'play') return false;
    this._selectUnit(u); this.panTo(u.x - this.W / 2);
    return true;
  };

  /* 회수: 유닛을 전장에서 거둬들인다. 스킬 칸이 사라지고 마법 유닛 자리가 하나 비며, 남은 체력만큼 마나를 돌려받는다.
     멈춤에 걸려 있으면 회수할 수 없다. 같은 유닛을 다시 소환하려면 소환 대기 시간을 기다려야 한다 */
  P.recall = function (u) {
    var C = CONFIG, R = C.RECALL; this.recallArm = null;
    if (!u || u.state === 'dead' || u.side !== 0) return false;
    if (u.stunUntil > this.time) { this._say(u.x, u.y - u.headY - 10, '멈춤 중에는 회수 불가', '#c9d1e3'); return false; }
    var r = null; this.roster.forEach(function (list) { list.forEach(function (q) { if (q.id === u.spawnId) r = q; }); });
    var back = this._refundOf(u);
    this.mana = Math.min(this.manaMax, this.mana + back); if (r) r.wait = r.cd;
    this._addEffect(u.x, u.y, R.fxArm, 0); this._play(R.snd, 0.9);
    this._say(u.x, u.y - u.headY - 10, '회수  +' + back, '#8fc7ff');
    this._removeSlots(u);
    u.state = 'dead'; u.deadT = 99; u.fade = 1; u.buffs = {};   // 쓰러지는 동작 없이 바로 사라진다
    if (this.sel === u) this.sel = null;
    return true;
  };

  /* 이 마법을 지금 쓸 대상이 시전자 가까이에 있는가. 있으면 { foe } (적에게 쓰는 마법이면 그 적), 없으면 null.
       적에게 쓰는 마법: 가장 가까운 적이 시전 거리 안 — 시전 거리 = 원본 행동 사거리 × RANGE_SCALE, 한도 maxCast
       아군에게 쓰는 마법: 효과 반경 안에 시전자 말고 다른 아군이 하나 이상
       변형: 조건 없음 */
  P.skillTarget = function (u, s) {
    var C = CONFIG, S = C.SKILL, L = this.units, i, o;
    if (s.needsFoe()) {
      var reach = Math.min(S.maxCast, s.act.range * C.RANGE_SCALE), best = null, bd = Infinity;
      for (i = 0; i < L.length; i++) { o = L[i]; if (o.side === u.side || o.state === 'dead') continue; var d = Math.abs(o.x - u.x); if (d < bd) { bd = d; best = o; } }
      return best && bd <= reach ? { foe: best } : null;
    }
    if (s.act.self) return { foe: null };                    // 자기에게만 거는 강화: 대상 조건 없음
    if (s.needsAlly()) {
      var r = s.kind === 'haste' ? S.buffRadius * 1.3 : s.act.sup === 'massheal' ? S.buffRadius * 1.5 : S.buffRadius;
      return { foe: null };                                  // 걸어 줄 다른 아군이 없으면 자기에게 건다 (2026-11-13 사용자 요청) — 효과 범위에는 시전자 자신도 들어 있다
    }
    return { foe: null };
  };

  /* 적 마법 유닛(u.auto)이 스스로 마법을 쓴다: 재사용 대기가 끝났고 대상이 가까이 있으면 쓴다. 한 프레임에 한 번만.
     매혹으로 우리 편이 된 적도 계속 스스로 쓴다(편만 바뀐다). 쿨타임은 여기서 줄인다 — 아군 칸은 _updateSlots 가 맡는다 */
  P._enemyMagic = function (dt) {
    var L = this.units, cast = false;
    for (var i = 0; i < L.length; i++) { var u = L[i]; if (!u.auto || !u.slots || !u.slots.length || u.state === 'dead') continue;
      for (var k = 0; k < u.slots.length; k++) { var s = u.slots[k]; if (s.cd > 0) { s.cd = Math.max(0, s.cd - dt); continue; }
        if (cast || u.stunUntil > this.time || !this.skillTarget(u, s)) continue;
        if (s.kind === 'buff' && u.buffs[s.act.sup] && u.buffs[s.act.sup].until > this.time) continue;   // 이미 걸려 있는 강화는 다시 쓰지 않는다
        if (s.kind === 'heal' && !L.some(function (o) { return o.side === u.side && o.state !== 'dead' && o.hp < o.maxHp * 0.7 && Math.abs(o.x - u.x) < 170; })) continue;
        if (this.castUnitSkill(u, k)) cast = true; else s.cd = 2; } }   // 실패하면 2초 뒤 다시 본다 (매 프레임 "대상 없음" 글자가 뜨지 않게)
  };

  /* 유닛 u가 자기 i번째 마법을 쓴다. 성공하면 그 칸에 쿨타임이 돈다 */
  P.castUnitSkill = function (u, i, pt) {   // pt = { x, y } 지점 지정(플레이어의 조준). 없으면 가장 가까운 대상에 자동으로 (적 마법 유닛, 아군·자기 대상 마법)
    var s = u.slots[i]; if (!s || u.state === 'dead') return false;
    if (s.cd > 0) { this._say(u.x, u.y - u.headY - 10, '쿨타임 ' + Math.ceil(s.cd), '#c9d1e3'); return false; }   // 눌렀는데 안 되는 이유를 알려 준다
    if (u.stunUntil > this.time) { this._say(u.x, u.y - u.headY - 10, '멈춤 중', '#c9d1e3'); return false; }
    if (!u.auto && !s.auto && this.mana < s.cost) { this._say(u.x, u.y - u.headY - 10, '마나 부족 (' + s.cost + ')', '#e0584a'); return false; }
    var a = s.act, S = CONFIG.SKILL, self = this, ok = false, tps = this.rules.tps;
    // 시전 조건: 시전자 가까이에 대상이 있어야 한다 — 적에게 쓰는 마법은 시전 거리 안의 적, 아군에게 쓰는 마법은 주변의 다른 아군 (skillTarget)
    var tg = pt ? { foe: pt } : this.skillTarget(u, s), foe = tg ? tg.foe : null;
    if (pt && s.kind === 'assassin') { foe = null; var bd0 = 45;   // 암살은 유닛 하나가 대상: 찍은 지점에서 가장 가까운 적
      this.units.forEach(function (o) { if (o.side === u.side || o.state === 'dead') return; var d0 = Math.hypot(o.x - pt.x, o.y - pt.y); if (d0 < bd0) { bd0 = d0; foe = o; } }); }
    if (!tg) { this._say(u.x, u.y - u.headY - 10, s.needsFoe() ? '가까이에 적이 없음' : '가까이에 아군이 없음', '#c9d1e3'); return false; }
    var allies = function (r) { return self.units.filter(function (o) { return o.side === u.side && o.state !== 'dead' && Math.abs(o.x - u.x) <= r; }); };
    var foesAt = function (c, r) { return self.units.filter(function (o) { return o.side !== u.side && o.state !== 'dead' && Math.hypot(o.x - c.x, o.y - c.y) <= r; }); };   // 원형 범위: 대상 적을 중심으로 반경 r 안 (전에는 가로 거리만 봐서 세로 줄 전체가 맞았다)

    if (s.kind === 'recall' && pt) {                         // 리콜 (원본 FUN_004b9590 case 0x34 / 0x3A): 찍은 곳 주변의 아군이 대형 그대로 시전자 곁으로 순간이동. 피해 없음
      var RR = this.aimRadius(s), R0 = this.rows, lo0 = this.laneY + R0[0], hi0 = this.laneY + R0[R0.length - 1], moved = 0;
      this.units.forEach(function (o) { if (o === u || o.side !== u.side || o.state === 'dead' || Math.hypot(o.x - pt.x, o.y - pt.y) > RR) return;
        self._addEffect(o.x, o.y, 3, 0); o.x = Math.max(CONFIG.BASE.front - 8, u.x + (o.x - pt.x)); o.y = Math.max(lo0, Math.min(hi0, u.y + (o.y - pt.y)));
        o.tgt = null; o.slotOf = null; o.slotA = null; o.slotAt = null; o.passY = null; o.blockT = 0; if (o.state !== 'attack') o.state = 'move'; self._addEffect(o.x, o.y, 3, 0.25); moved++; });
      if (moved) ok = true; else { this._say(pt.x, pt.y - 12, '불러올 아군이 없음', '#c9d1e3'); return false; }
    } else if (s.kind === 'blast' && foe) {                         // 가장 가까운 적을 중심으로 범위 피해 (원본 피해 공식 × dmgMul)
      var keep = u.act; u.act = a;
      foesAt(foe, a.aoe ? S.radius * (u.side === 0 ? 1 + this.radiusUp : 1) : 60).forEach(function (o) { self._damage(o, self.rules.damage(u, o, self.rng) * S.dmgMul * (u.side === 0 ? (1 + self.dmgUp) * blastTier(a) : 1)); });
      if (S.friendlyFire[a.name]) { var fr = a.aoe ? S.radius * (u.side === 0 ? 1 + this.radiusUp : 1) : 60, fm = S.dmgMul * (u.side === 0 ? (1 + this.dmgUp) * blastTier(a) : 1);   // 아군도 맞는다
        this.units.forEach(function (o) { if (o.side === u.side && o.state !== 'dead' && Math.hypot(o.x - foe.x, o.y - foe.y) <= fr) self._damage(o, self.rules.damage(u, o, self.rng) * fm); }); }
      var HO = MWE.OriginalRules.HOLY;
      if (HO && a.arm === HO.arm) {                          // 홀리 크로스 (원본 case 0x10, 분석 8-43): 범위 안의 아군은 회복 + 상태 이상 해제, 언데드 적은 석화
        var hr = S.radius * (u.side === 0 ? 1 + this.radiusUp : 1), hv = this.rules.attackValue(u) + HO.heal;
        this.units.forEach(function (o) { if (o.state === 'dead' || Math.hypot(o.x - foe.x, o.y - foe.y) > hr) return;
          if (o.side === u.side) { var got = Math.min(o.maxHp - o.hp, hv); o.hp += got; if (got > 0) self._say(o.x, o.y - o.t.h - 6, '+' + got, '#8fe89a'); o.stunUntil = 0; delete o.buffs.meltw; delete o.buffs.melta; delete o.buffs.poison; delete o.buffs.slow; }   /* 아군 상태 이상 해제 (원본 case 0x10, 8-43): 석화·멜팅 웨폰·멜팅 아머·중독·감속 */
          else if (o.t.race === HO.race && !o.t.immune) { o.stunUntil = Math.max(o.stunUntil || 0, self.time + HO.stoneTicks / tps); o.state = 'idle'; delete o.buffs.weapon; delete o.buffs.shield; delete o.buffs.haste; } }); }
      u.act = keep; this._addEffect(foe.x, foe.y, a.arm, 0); this.flash = 0.2; ok = true;
    } else if (s.kind === 'heal') {                          // 주변 아군 회복. 말다 소환(massheal)은 더 넓게, 전부 회복
      var mass = a.sup === 'massheal', HL = mass && pt ? this.units.filter(function (o) { return o.side === u.side && o.state !== 'dead' && Math.hypot(o.x - pt.x, o.y - pt.y) <= S.summonRadius; }) : allies(mass ? S.buffRadius * 1.5 : S.buffRadius);   // 말다 소환은 찍은 곳 둘레
      // 힐링(2026-11-13 너프 — 마나 15로 주변 전원을 50%씩 채워 너무 셌다): 주변에서 체력 비율이 가장 낮은 healMax(3)기만, 최대 체력의 healRatio(35%)씩. 말다 소환은 그대로(범위 안 전원 완전 회복)
      if (!mass) HL = HL.filter(function (o) { return o.hp < o.maxHp; }).sort(function (p, q) { return p.hp / p.maxHp - q.hp / q.maxHp; }).slice(0, S.healMax);
      HL.forEach(function (o) { var h = mass ? o.maxHp : Math.round(o.maxHp * S.healRatio), got = Math.min(o.maxHp - o.hp, h);
        o.hp += got; if (got > 0) self._say(o.x, o.y - o.t.h - 6, '+' + got, '#8fe89a'); if (mass) { o.stunUntil = 0; delete o.buffs.meltw; delete o.buffs.melta; delete o.buffs.poison; delete o.buffs.slow; }   /* 말다 소환은 상태 이상도 푼다 (원본 case 0x38) */ if (!mass) self._addEffect(o.x, o.y - o.t.h * 0.5, a.arm, 0); });
      if (mass) this._addEffect(pt ? pt.x : u.x, pt ? pt.y : this.laneY, a.arm, 0);
      ok = true;
    } else if (s.kind === 'buff') {                          // 주변 아군에게 강화. 배수는 원본 규칙(OriginalRules)이 buffs를 보고 적용한다
      // 강화(파운틴 베리어·웨폰): 누르면 바로, 시전자 주변(buffRadius)의 **공격 유닛 buffMax(2)기**에게 buffSec(7초) 동안 걸린다.
      // 2026-11-13: 아군을 찍는 대상 지정은 조작이 어려워 되돌림(사용자). 남발·화면 가득 참을 막는 장치는 "2기 + 7초"로 유지.
      // 고르는 순서: 그 강화가 없는 유닛 먼저, 그다음 적에게 가까운(앞에 선) 유닛. 자기 전용(아이스 웨폰 등, 원본 +0x3C == 0xFFFF)은 시전자만. 걸어 줄 공격 유닛이 없으면 자기에게
      var hasB = function (o) { return o.buffs[a.sup] && o.buffs[a.sup].until > self.time ? 1 : 0; }, BT;
      if (a.self) BT = [u];
      else { BT = allies(S.buffRadius).filter(function (o) { return o !== u && o.act; }).sort(function (p, q) { return (hasB(p) - hasB(q)) || (u.side === 0 ? q.x - p.x : p.x - q.x); }).slice(0, S.buffMax); if (!BT.length) BT = [u]; }
      BT.forEach(function (o) { o.buffs[a.sup] = { k1: a.k1, k2: a.k2, arm: a.arm, until: self.time + S.buffSec }; });
      ok = true;
    } else if (s.kind === 'haste') {                         // 주변 아군이 빨리 걷는다 (케멘 소환). 걸린 유닛 머리 위에 원본 가속 이펙트(칸 44)
      (pt ? this.units.filter(function (o) { return o.side === u.side && o.state !== 'dead' && Math.hypot(o.x - pt.x, o.y - pt.y) <= S.summonRadius; }) : allies(S.buffRadius * 1.3)).forEach(function (o) { o.buffs.haste = { arm: a.arm, until: self.time + (a.dur || 600) / tps }; });   // 찍었으면 찍은 곳 둘레
      this._addEffect(pt ? pt.x : u.x, pt ? pt.y : this.laneY, a.arm, 0); ok = true;
    } else if (s.kind === 'dispel') {                        // 술 소환 (원본 FUN_004b9590 case 0x36, 분석 8-29): 찍은 곳 둘레의 적은 강화(무기·방어막·가속)가 풀리고, 아군은 약화·멈춤이 풀린다. 피해 없음. 면역 유닛 제외
      // 가드 (2026-11-13 사용자 요청): 범위 안에 풀 것이 있는 유닛(강화가 걸린 적, 약화·멈춤이 걸린 아군)이 하나도 없으면 쓰이지 않는다 — 마나·재사용 대기 그대로
      var dc = pt || this._nearestFoe(u) || u, T0 = this.time, live = function (b) { return b && b.until > T0; };
      // 중독도 풀고, 적에게 매혹돼 넘어간 우리 유닛(charmed 이고 지금 상대편)은 되돌린다 (원본의 +0x54 연결 끊기 — 연결의 주인이 시전자의 동맹일 때만). 우리가 매혹한 적은 그대로
      var DK = function (o) { return o.side !== u.side ? ['weapon', 'shield', 'haste', 'berserk'] : ['meltw', 'melta', 'slow', 'poison']; };
      var DL = this.units.filter(function (o) { return o.state !== 'dead' && !o.t.immune && Math.hypot(o.x - dc.x, o.y - dc.y) <= S.summonRadius && (DK(o).some(function (k) { return live(o.buffs[k]); }) || (o.side === u.side && o.stunUntil > T0) || (o.side !== u.side && o.charmed)); });
      if (!DL.length) { this._say(dc.x, dc.y - 12, '풀 것이 없음', '#c9d1e3'); return false; }
      DL.forEach(function (o) { DK(o).forEach(function (k) { delete o.buffs[k]; }); if (o.side === u.side) o.stunUntil = 0; else if (o.charmed) { self._setSide(o, u.side); o.charmed = false; o.state = 'idle'; }
        self._say(o.x, o.y - o.headY - 6, '해제', '#9fd8ff'); });
      this._addEffect(dc.x, dc.y, a.arm, 0); ok = true;
    } else if (s.kind === 'weaken' && foe) {                 // 범위 안 적의 공격(멜팅 웨폰)·방어(멜팅 아머)를 무너뜨린다 — 수치는 원본 규칙이 buffs를 보고 적용
      foesAt(foe, S.radius).forEach(function (o) { o.buffs[a.sup] = { arm: a.arm, until: self.time + (a.dur || 600) / tps }; self._say(o.x, o.y - o.headY - 6, '약화', '#c7a0ff'); });
      this._addEffect(foe.x, foe.y, a.arm, 0); ok = true;
    } else if (s.kind === 'stun' && foe) {                   // 범위 안의 적을 잠시 멈춘다
      var ud = u.side === 0 ? S.undeadDmg[a.name] || 0 : 0;   // 디펜스 고유: 턴 언데드·디스트로이 언홀리는 걸리는 종족에게 피해도 준다 (원본 case 0xE·0xF 는 석화만 — 하급 언데드를 쓸어 내는 마법이라는 사용자 요청, 2026-11-13). 방어 무시, 마법 증폭 적용
      foesAt(foe, S.radius * (u.side === 0 ? 1 + this.radiusUp : 1)).forEach(function (o) { if (a.races && a.races.indexOf(o.t.race) < 0) return;   // 걸리는 종족만 (턴 언데드 = 언데드, 디스트로이 언홀리 = 언데드 + 흡혈귀·늑대인간류, 분석 8-36)
        o.stunUntil = self.time + stunSecOf(a); o.state = 'idle'; delete o.buffs.weapon; delete o.buffs.shield; delete o.buffs.haste;
        if (ud) self._damage(o, ud * (1 + self.dmgUp)); });
      this._addEffect(foe.x, foe.y, a.arm, 0); ok = true;
    } else if (s.kind === 'charm' && foe) {                  // 범위 안의 적이 우리 편이 되어 싸운다   // 한 번에 charmMax(3)기까지 — 찍은 곳에 가까운 순서
      foesAt(foe, S.radius * 0.7).sort(function (p, q) { return Math.hypot(p.x - foe.x, p.y - foe.y) - Math.hypot(q.x - foe.x, q.y - foe.y); }).slice(0, S.charmMax).forEach(function (o) { self._setSide(o, u.side); o.charmed = !o.charmed; o.state = 'idle'; self._say(o.x, o.y - o.t.h - 6, '매혹', '#ff9ad5'); });   // charmed: 원래 편이 아닌 동안 하트 표시 (되매혹하면 풀린다)
      this._addEffect(foe.x, foe.y - 20, a.arm, 0); ok = true;
    } else if (s.kind === 'assassin' && foe) {               // 가장 가까운 적 하나를 쓰러뜨린다
      this._damage(foe, foe.hp); ok = true;
    } else if (s.kind === 'morph') {                         // 다른 형태로 (엔트 ↔ 지상 엔트). 체력 비율은 유지
      var to = this.types[CONFIG.MORPH[u.t.id]];
      if (to) { var ratio = u.hp / u.maxHp; u.setType(to); u.hp = Math.max(1, Math.round(u.maxHp * ratio)); this._applyType(u); u.face(u.dir, -u.dir); ok = true; }
    }
    if (!ok) { this._say(u.x, u.y - u.headY - 10, '대상 없음', '#c9d1e3'); return false; }
    if (!u.auto && !s.auto) { this.mana -= s.cost;                      // 내가 쓴 마법: 터진 곳(적에게 쓰는 마법은 그 적, 아니면 시전자)이 화면 가운데에 오도록 카메라가 미끄러져 간다
      this.camGoal = { x: (foe && s.kind !== 'recall' ? foe.x : u.x) - this.W / 2, until: this.time + CONFIG.CAM.skillSec }; this.manualUntil = 0; }
    s.cd = s.cdMax; this._sortSlots();                       // 방금 쓴 칸은 바로 뒤로 간다
    this._say(u.x, u.y - u.t.h - 18, a.name, u.side === 0 ? '#ffd36e' : '#ff8a7a');   // 적이 쓴 마법은 붉은 글씨
    this._play(a.snd, 1);
    return true;
  };

  /* ───────────────────────── 5. update ───────────────────────── */
  P._frame = function (ts) {
    var dt = Math.min(0.05, (ts - this._last) / 1000 || 0); this._last = ts;   // 탭이 멈췄다 돌아와도 한 번에 0.05초까지만 진행
    if (!this.ground && this.assets.ready()) {               // 그림이 다 왔다: 바닥을 만들고 시작 화면으로 (바닥이 없으면 어느 화면에서든 먼저 만든다)
      this.terrain = new MWE.TerrainRenderer(this.map, this.assets.get('tiles'));
      this._makeGround();
      if (this.screen === 'loading') this.screen = 'title';
    }
    if (this._pendStart && this.assets.ready()) { this._pendStart = false; this.reset(); this.screen = 'play'; }   // 적 종족을 고른 뒤 그림을 기다리던 시작
    // 바닥 조각을 0.5초마다 다시 그린다: 큰 이펙트 시트(나누기 전 arms.png 는 2,150만 픽셀)를 펼칠 때 아이폰에서 보조 캔버스가 비워져 전장 바닥만 검게 나오던 문제의 복구 (448×192 한 장이라 비용은 작다)
    else if (this.ground && this.terrain && this.time - this._groundAt > 0.5) this._makeGround();
    if (this.screen === 'play' && !this.paused && !this.cards && !this.modal) this.update(dt);   // 카드를 고르는 동안과 상성 모달이 떠 있는 동안은 멈춘다
    if (this.cards) this.cardT += dt;
    if (this.modal) this.modalT += dt;
    if (!(this.screen === 'play' && (this.cards || this.modal))) this.time += dt;   // 카드·모달로 멈춘 동안에는 게임 시간도 멈춘다 — 전에는 시간만 흘러 강화·석화·쿨타임이 그동안 닳았다 (2026-11-13)
    this.draw();
  };

  P.update = function (dt) {
    var C = CONFIG, i;
    this.rules.now = this.time;                              // 강화(buffs)의 남은 시간을 규칙이 알 수 있게
    // 마나 회복, 버튼 대기 시간, 스킬 쿨타임
    this.mana = Math.min(this.manaMax, this.mana + this.regenNow() * dt);
    this.roster.forEach(function (list) { list.forEach(function (r) { r.wait = Math.max(0, r.wait - dt); }); });
    this._updateSlots(dt);
    this.flash = Math.max(0, this.flash - dt); this.baseHit = Math.max(0, this.baseHit - dt);
    if (this.aim && this.groups.indexOf(this.aim.group) < 0) this.aim = null;   // 조준하던 마법을 가진 유닛이 모두 사라지면 조준도 풀린다
    if (this.sel && !this._recallable(this.sel)) this.sel = null;   // 고른 유닛이 쓰러지거나 사라지면 선택도 사라진다
    this._scrollBtns(0);                                     // 탭·유닛 수가 바뀌어도 소환 캐러셀이 범위 밖에 남지 않게

    this._updateWave(dt);
    // 유닛 행동. 걷는 유닛은 **실제로 움직인 방향**을 본다 (8방향) — 줄을 바꾸거나 대열 자리로 대각선·세로로 갈 때 몸은 옆을 본 채 미끄러지던 것을 고침
    for (i = 0; i < this.units.length; i++) { var mu = this.units[i], px = mu.x, py = mu.y; this._updateUnit(mu, dt);
      if (mu.state === 'move') { var mdx = mu.x - px, mdy = mu.y - py; if (mdx * mdx + mdy * mdy > 0.01) this._faceVec(mu, mdx, mdy); } }
    this._separate(dt);
    this._updateShots(dt);
    this._updateGarrison();
    this._enemyMagic(dt);
    this._selfMagic();
    this._holdSlot(); this._holdBtn();
    this._updateCamera(dt);

    // 사라질 것 정리: 쓰러진 뒤 다 흐려진 유닛, 끝난 이펙트·글자
    var T = this.time;
    this.units = this.units.filter(function (u) { return !(u.state === 'dead' && u.fade >= 1); });
    this.effects = this.effects.filter(function (e) { return (T - e.t0) * 15 < e.f.length; });
    this.texts = this.texts.filter(function (t) { return T - t.t0 < 0.8; });

    // 승패
    if (this.baseHp <= 0) { this.baseHp = 0; this.screen = 'lose'; }
    else if (this.wave >= C.WAVES.length && !this._alive(1).length) this.screen = 'win';
  };

  /* 웨이브 알림을 띄운다: "웨이브 N" + 이 웨이브에 처음 나오는 적 종류 (작은 그림과 이름) */
  P._announce = function (i) {
    var w = CONFIG.WAVES[i], self = this; if (!w) return;
    var fresh = []; w.list.forEach(function (e) { if (!self.seenFoes[e[0]]) { self.seenFoes[e[0]] = 1; if (self.types[e[0]]) fresh.push(self.types[e[0]]); } });
    this.banner = { wave: i, t0: this.time, fresh: i === 0 ? [] : fresh };   // 첫 웨이브는 "새로운 적"을 따로 알리지 않는다
  };

  /* ── 성장: 경험치 → 레벨업 → 카드 ── */
  P._topH = function () { return 56; };   // 2026-11-13: 수비대 현황 줄을 뺐다(사용자 요청) — 수비대는 건물 가장자리의 실루엣으로 보인다   // 위 왼쪽 상자(기지·마나·경험치 [+ 수비대])의 높이
  P._xpNeed = function () { var G = CONFIG.GROW; return Math.round(G.base * Math.pow(G.grow, this.plv - 1)); };
  P._gainXp = function (n) {
    this.xp += n;
    while (this.xp >= this._xpNeed()) { this.xp -= this._xpNeed(); this.plv++; this.pendingLv++; }
    if (this.pendingLv && !this.cards) this._offerCards();
  };
  /* 유닛 레벨을 바꾼다: 최대 체력이 원작 식(종류 체력 + 레벨당 성장 × 레벨, 영웅은 heroHp배)으로 오르고 오른 만큼 지금 체력도 는다.
     공격·방어는 원작 피해 식이 레벨을 본다 (공격 = k1 × 레벨 ÷ 8 + …, 방어 = 방어력 + 성장 × 레벨 ÷ 4) */
  P._setLevel = function (u, L) {
    var mh = Math.round(u.t.maxHpAt(L));
    u.level = L; u.hp += Math.max(0, mh - u.maxHp); u.maxHp = mh;
  };
  /* 영웅 한 명을 전장에 올린다: 기본 유닛으로 나온 뒤 종류를 영웅 종류로 바꾸고(이름·초상화·수치), 레벨을 올리고, 마법은 스스로 쓰게 한다 */
  P.spawnHero = function (h) {
    var G = CONFIG.GROW, u = this.spawn(h.base.id, 0), self = this;
    u.t = h.t; u.hero = h; this._applyType(u); u.maxHp = 0; this._setLevel(u, 1 + this.allyLv + G.heroLv); u.hp = u.maxHp;
    u.slots.forEach(function (s) { s.auto = true; s.cost = 0; s.cdMax = G.heroCool; s.cd = 2 + self.rng.next() * 3; });   // 패널에 올리지 않는다 → _selfMagic 이 맡는다
    var k = this.magicUnits.indexOf(u); if (k >= 0) this.magicUnits.splice(k, 1); this._regroup();
    this._addEffect(u.x, u.y, CONFIG.RECALL.fxArm, 0); this._say(u.x, u.y - u.headY - 14, '영웅 ' + h.name, '#ffd36e'); this._play(u.t.snd.ready, 0.9);
    return u;
  };
  /* 카드 3장을 낸다 (서로 다른 종류, 무작위). 게임은 멈춘다 */
  P._offerCards = function () {
    var G = CONFIG.GROW, self = this, pool = ['lv', 'mana', 'magic', 'radius'], out = [];
    var free = this.heroDefs.filter(function (h) { return !self.units.some(function (u) { return u.hero === h && u.state !== 'dead'; }); }); if (free.length && this.wave + 1 >= G.heroFromWave) pool.push('hero');   // 영웅은 한 명씩만 — 전장에 없는 영웅 중에서 무작위
    if (this.baseHp < CONFIG.BASE.hp * 0.9) pool.push('repair');
    for (var i = pool.length - 1; i > 0; i--) { var r = Math.floor(this.rng.next() * (i + 1)), t = pool[i]; pool[i] = pool[r]; pool[r] = t; }
    pool.slice(0, 3).forEach(function (k) {
      var c = { kind: k };
      if (k === 'lv') { c.name = '전군 단련'; c.desc = '모든 아군의 레벨 +' + G.lvStep + ' — 지금 있는 유닛과 앞으로 소환할 유닛 모두'; c.tag = '유닛 Lv ' + (1 + self.allyLv) + ' → ' + (1 + self.allyLv + G.lvStep); }
      else if (k === 'hero') { var h = free[Math.floor(self.rng.next() * free.length)]; c.hero = h; c.unit = h.t; c.name = h.name; c.desc = '영웅 ' + h.name + '(' + h.t.job + ')이 마나 없이 나옵니다. 마법은 스스로 씁니다'; c.tag = 'Lv ' + (1 + self.allyLv + G.heroLv) + ' · 체력 ' + Math.round(h.t.maxHpAt(1 + self.allyLv + G.heroLv)); }
      else if (k === 'mana') { c.name = '마나의 샘'; c.desc = '마나 회복 +' + G.manaRegen + '/초, 최대 마나 +' + G.manaMax; c.tag = '회복 ' + (+self.regenNow().toFixed(1)) + ' → ' + (+(self.regenNow() + G.manaRegen).toFixed(1)); }
      else if (k === 'magic') { c.name = '마법 증폭'; c.desc = '범위 공격 마법의 피해 +' + Math.round(G.dmg * 100) + '%'; c.tag = '피해 +' + Math.round((self.dmgUp + G.dmg) * 100) + '%'; }
      else if (k === 'radius') { c.name = '마법 확산'; c.desc = '적에게 쓰는 마법의 범위 +' + Math.round(G.radius * 100) + '%'; c.tag = '범위 +' + Math.round((self.radiusUp + G.radius) * 100) + '%'; }
      else { c.name = '성 수리'; c.desc = '기지 체력을 ' + Math.round(G.repair * 100) + '% 회복합니다'; c.tag = '기지 ' + Math.ceil(self.baseHp) + ' → ' + Math.min(CONFIG.BASE.hp, Math.ceil(self.baseHp + CONFIG.BASE.hp * G.repair)); }
      out.push(c); });
    // 자리: 전장 가운데에 가로로 3장
    var W = this.W, H = this.H, g = 8, cw = Math.min(118, Math.floor((W - 16 - g * 2) / 3)), ch = 200, x0 = Math.round((W - (cw * 3 + g * 2)) / 2), y0 = Math.round((H - this.hudH) / 2 - ch / 2 + 20);
    out.forEach(function (c, k) { c.box = { x: x0 + k * (cw + g), y: y0, w: cw, h: ch }; });
    this.cards = out; this.cardT = 0; this.aim = null; this.sel = null; this.drag = null;
  };
  /* 카드 i를 고른다 → 효과 적용, 게임 재개. 레벨이 한꺼번에 여러 번 올랐으면 이어서 다음 카드 */
  P.pickCard = function (i) {
    var c = this.cards && this.cards[i], G = CONFIG.GROW, self = this; if (!c) return false;
    if (c.kind === 'lv') { this.allyLv += G.lvStep; this.units.forEach(function (u) { if (u.side === 0 && u.state !== 'dead') { self._setLevel(u, u.level + G.lvStep); self._say(u.x, u.y - u.headY - 10, 'Lv ' + u.level, '#ffd36e'); } }); }
    else if (c.kind === 'hero') this.spawnHero(c.hero);
    else if (c.kind === 'mana') { this.manaRegen += G.manaRegen; this.manaMax += G.manaMax; }
    else if (c.kind === 'magic') this.dmgUp += G.dmg;
    else if (c.kind === 'radius') this.radiusUp += G.radius;
    else if (c.kind === 'repair') { this.baseHp = Math.min(CONFIG.BASE.hp, this.baseHp + CONFIG.BASE.hp * G.repair); this.forts.forEach(function (f) { if (f.isFort && !f.dead) f.hp = Math.min(f.maxHp, f.hp + f.maxHp * G.repair); }); }   // 살아 있는 벙커도 같은 비율로
    this.cards = null; this.pendingLv = Math.max(0, this.pendingLv - 1);
    if (this.pendingLv) this._offerCards();
    return true;
  };

  /* 웨이브 진행: 대기열에서 한 기씩 꺼내 내보내고, 다 나오면 쉬었다가 다음 웨이브 */
  P._updateWave = function (dt) {
    var C = CONFIG, w = C.WAVES[this.wave]; if (!w) return;
    if (this.queue.length) {
      this.spawnT -= dt;
      if (this.spawnT <= 0) { this.spawn(this.queue.shift(), 1); this.spawnT = w.gap; if (!this.queue.length) this.restT = w.rest; }
    } else {
      // 이 웨이브가 다 나왔다 → 쉬는 시간이 지나거나 적이 전멸하면 다음 웨이브
      // restT 는 쉬는 시간에서 시작해 줄어든다 → 다 나온 뒤 maxWait 초가 지나면 −(maxWait − rest)
      this.restT -= dt; var P = C.WAVE_PACE, nA = this._alive(1).length;
      if (!nA || (this.restT <= 0 && nA <= P.left) || this.restT <= -(P.maxWait - w.rest)) { this.wave++; this.queue = this._waveQueue(this.wave); this.spawnT = 1.5; this._announce(this.wave); }
    }
  };

  P._alive = function (side) { return this.units.filter(function (u) { return u.side === side && u.state !== 'dead'; }); };

  /* 유닛 한 기의 행동: (쓰러짐·멈춤) → 공격 동작 진행 → 닿는 적이 있으면 공격 시작 → 옆줄의 적에게 다가가기 → 줄 서기 → 전진 */
  P._updateUnit = function (u, dt) {
    var R = this.rules, C = CONFIG, tps = R.tps;
    if (u.state === 'dead') { u.deadT += dt; if (u.deadT > 1.2) u.fade = Math.min(1, u.fade + dt * 1.5); return; }
    var ps = u.buffs.poison;                                 // 중독 (원본 FUN_00454580, 분석 8-26): 2틱마다 체력 −1, 1 밑으로는 안 내려간다 (12틱/초 → 초당 6)
    if (ps) { if (ps.until <= this.time) delete u.buffs.poison; else { u.poisonAcc = (u.poisonAcc || 0) + dt * tps / 2; while (u.poisonAcc >= 1) { u.poisonAcc -= 1; if (u.hp > 1) u.hp--; } } }
    if (u.stunUntil > this.time) { u.state = 'idle'; return; }   // 멈춤 스킬에 걸림
    if (u.side === 0) this._bodyTech(u);
    u.cd = Math.max(0, u.cd - dt);
    if (u.boom && this._boom(u)) return;
    if (u.castOrder && u.state !== 'attack' && this._castWalk(u, dt)) return;
    if (u.fleeUntil > this.time && u.side === 0 && !u.castOrder) {   // 도망: 맞은 지원 유닛이 성 쪽으로 물러난다 (FLEE_SEC 초, 성 앞 선까지만). 끝나면 다시 자리로 돌아온다
      var fx = Math.max(C.BASE.front + 10, u.x - this._speed(u) * C.FLEE_SPEED * dt);
      if (fx < u.x) { u.x = fx; u.state = 'move'; u.walkT += dt; this._faceVec(u, -1, 0); u.hold = null; u.slotOf = null; u.slotA = null; u.passY = null; return; }
    }   // 마법을 쓰러 걸어가는 중 (치던 동작은 마저 끝내고)

    if (u.state === 'attack') {
      // 공격 동작: 원본 애니메이션을 틱 속도(초당 12장)로 넘기다가, 중간 프레임에서 실제 타격
      var A = u.t.anim.atk, n = A ? A.n : 6, hitAt = A && A.hit != null ? A.hit : Math.floor(n * 0.6);   // 원본 이벤트 프레임(data.js anim.atk.hit). 2026-11-13: 없는 필드(ev)를 보고 있어 늘 0.6 지점에서 치던 것을 고침
      u.at += dt * tps;
      if (!u.hitDone && u.at >= hitAt) { u.hitDone = true; this._strike(u); }
      var X = R.extraHits ? R.extraHits(u.act) : null;         // 연속 타격 (분석 8-41): 명궁의 에로우 샤워는 화살 네 발(프레임 5·10·12·14), 무도가의 컴비네이션 어택은 두 번
      if (X) { if (u.at < X[0]) u.xN = 0; while ((u.xN || 0) < X.length && u.at >= X[u.xN]) { u.xN = (u.xN || 0) + 1; this._strike(u); } }
      if (u.at >= n) { u.state = 'idle'; u.cd = R.cooldown(u, this.rng); }
      return;
    }

    var tgt = this._nearestFoe(u), dist = tgt ? this._dist(u, tgt) : Infinity, adx = tgt ? Math.abs(tgt.x - u.x) : Infinity;
    if (u.side === 0 && u.act && !u.castOrder) {              // 아군 AI: 물러서기와 교대 (CONFIG.AI)
      var AI = C.AI, T0 = this.time;
      if (u.x > this.frontX + AI.pullOver && this._attackers(u) >= AI.pullMin) u.pullUntil = T0 + AI.pullSec;          // ① 집결선 너머에서 둘 이상에게 맞는다 → 물러선다
      if (u.pullUntil > T0) { if (u.x > this.frontX - 6) { u.x -= Math.min(u.x - (this.frontX - 6), this._speed(u) * dt); u.state = 'move'; u.walkT += dt; this._faceVec(u, -1, 0); u.hold = null; u.slotOf = null; u.slotA = null; u.passY = null; return; } u.pullUntil = 0; }
      if (u.rangePx < 80 && !u.hero && u.hp <= u.maxHp * AI.coverHp && adx <= AI.engage) {                             // ② 다친 근접 유닛 → 멀쩡한 근접 아군 뒤로
        var cv = this._coverFor(u);
        if (cv) { var cx2 = cv.x - AI.coverBack, cy2 = cv.y, cd2 = Math.hypot(cx2 - u.x, cy2 - u.y);
          if (cd2 > 5) { var cs = Math.min(cd2, this._speed(u) * dt); u.x += (cx2 - u.x) / cd2 * cs; u.y += (cy2 - u.y) / cd2 * cs; u.state = 'move'; u.walkT += dt; this._faceVec(u, cx2 - u.x, cy2 - u.y); u.hold = null; u.slotOf = null; u.slotA = null; u.passY = null; return; }
          if (dist > u.rangePx) { u.state = 'idle'; this._look(u, 1); return; } }                                      // 뒤에 섰다: 적이 닿지 않으면 기다린다 (닿으면 아래에서 싸운다)
      }
    }
    if (u.act) {
      // 공격할 대상: 맞은편 유닛 중 가장 가까운 것. 적은 대상이 없으면 기지를 친다
      var baseDist = u.side === 1 ? u.x - C.BASE.front : Infinity;
      var canHitUnit = dist <= u.rangePx, fortT = u.side === 1 && !canHitUnit ? this._fortFor(u) : null, canHitBase = !canHitUnit && (!!fortT || baseDist <= u.rangePx);   // fortT = 때릴 벙커 (유닛이 든 벙커가 어그로를 끈다)
      // 근접 유닛이 적에게 닿았어도, 맡은 자리(적 둘레의 빈칸)에 아직 못 갔으면 먼저 자리로 간다 — 앞에서 멈춰 뒤따르는 유닛의 길을 막지 않게.
      // 단, 내가 둘러싸이는 쪽(besieged)이면 움직이지 않고 그 자리에서 싸운다 (서로 자리를 잡으려다 뒤로 밀려나는 것 방지)
      var melee = u.rangePx < 80, held = melee && tgt && this._besieged(u);
      if (held) { u.slotOf = null; u.slotA = null; }                   // 지키는 쪽은 자기가 맡았던 자리를 내려놓는다 — 서로 "네가 와라" 하며 멈춰 서는 것을 막는다
      if (canHitUnit && melee && !held && u.slotAt !== tgt.uid) { this._approach(u, tgt, dt); return; }
      if (canHitUnit || canHitBase) {
        if (canHitUnit) this._faceVec(u, tgt.x - u.x, tgt.y - u.y, true);   // 때릴 적을 바라본다 (8방향 — 위아래에 있는 적도 그쪽을 보고 친다)
        if (u.cd <= 0) { u.state = 'attack'; u.at = 0; u.hitDone = false; u.tgt = canHitUnit ? tgt : fortT || 'base'; this._play(u.act.snd, 0.5); }
        else u.state = 'idle';
        return;
      }
      // 근접 유닛: 적이 가까이 있으면 줄을 풀고 그 적에게 바로 다가간다 → 한 적을 여럿이 둘러싸서 친다 (_approach)
      // 근접: 적이 가까이 있으면 다가간다. 아군은 집결선 너머 멀리(leash)까지는 쫓지 않지만, **대열 뒤로 빠져나간 적**(성 쪽에 있는 적)은 거리와 상관없이 쫓아가 잡는다 — 안 그러면 성 앞에 선 적과 가운데 선 아군이 서로 손을 못 댄다
      if (tgt && melee && (adx <= u.rangePx + C.SURROUND.engage || (u.side === 0 && tgt.x < u.x - 60)) && !(u.side === 0 && tgt.x > this.frontX + C.HOLD.leash)) {
        if (held) this._stepToward(u, tgt, dt); else this._approach(u, tgt, dt);   // 둘러싸이는 쪽은 자리를 잡으러 돌지 않고, 닿을 때까지만 곧장 다가간다
        return;
      }
      // 원거리 유닛: 가로로는 닿는데 못 쏘는 경우는 없다 (거리를 가로로만 잰다)
      // 원거리 아군: 집결선 근처(leash 안)에 적이 있는데 사거리가 모자라면 대열에서 나와 닿을 때까지 다가간다 — 지상 근접이 못 때리는 공중 적(드래곤)이 사거리 밖에서 버티면 아무도 손을 못 대 게임이 끝나지 않았다 (2026-11-12)
      if (tgt && !melee && u.side === 0 && tgt.x <= this.frontX + C.HOLD.leash) { this._stepToward(u, tgt, dt); return; }
    } else if (u.side === 1 && !u.slots.length) {            // 공격도 마법도 없는 적(적 마법이 꺼져 있을 때의 메두사·사탄·서큐버스): 아군을 지나쳐 성까지 가 버리면 잡을 길이 없으므로, 가장 가까운 아군에게 다가와 그 앞에 선다 (2026-11-12 사용자 제안: 적이 아군 쪽으로 오게)
      if (tgt) { if (Math.hypot(tgt.x - u.x, tgt.y - u.y) <= 34) { u.state = 'idle'; return; } var hx = tgt.x - u.x, hy = tgt.y - u.y, hd = Math.hypot(hx, hy), hs = Math.min(hd, this._speed(u) * dt); u.x += hx / hd * hs; u.y += hy / hd * hs; u.state = 'move'; u.walkT += dt; return; }
    } else if (adx <= (u.supDist || C.SUPPORT_DIST)) { u.state = 'idle'; return; }   // 기본 공격이 없는 유닛(아군 지원 유닛, 마법을 쓰는 적)은 적과 거리를 두고 선다
    // 전진 한계: 아군은 집결선(전장 가운데), 적은 성 앞 (매혹된 적은 아군 규칙)
    if (u.side === 0 && u.x >= this.frontX - C.HOLD.zone) { this._holdStep(u, dt); return; }   // 집결선 근처: 대열의 자기 자리로 가서 선다
    if (u.side === 1 && u.x <= C.BASE.front) { u.state = 'idle'; return; }
    // 줄 서기: 같은 줄 바로 앞에 같은 편이 있으면 멈춰 기다린다. 기다리는 동안 적이 있는 줄 쪽으로 조금씩 비켜 서서 빈자리를 찾는다
    // 줄 서기와 추월: 같은 줄 바로 앞에 같은 편이 있으면 멈춰 기다린다.
    // 막힌 시간이 쌓이면(앞사람이 느려서 붙었다 떨어졌다 해도 쌓이도록 천천히 줄인다) 가까운 빈 줄을 골라 그 줄로 옮겨 가서 앞지른다
    var blocked = this._blockedAhead(u);
    // 앞지르기: 앞사람이 나보다 느리게 걷고 있으면 기다리지 않는다 — 멀리서 미리 옆줄로 비켜 걸음을 멈추지 않고 지나간다 (빠른 유닛이 느린 유닛 뒤에서 섰다 갔다 하던 것을 없앤다)
    if (u.passY == null && C.PASS_LOOK > 0 && this._slowAhead(u)) { u.passY = this._freeRow(u); u.passT = 0; }
    if (blocked) u.blockT += dt; else u.blockT = Math.max(0, u.blockT - dt * 0.5);
    if (u.blockT >= C.PASS_WAIT && u.passY == null) { u.passY = this._freeRow(u); u.passT = 0; if (u.passY == null) u.blockT = 0; }
    if (u.passY != null) { u.passT += dt; this._shiftRow(u, u.passY, Math.max(45, this._speed(u) * 0.9) * dt); if (Math.abs(u.passY - u.y) < 1 || u.passT > 2) { u.passY = null; u.blockT = 0; } }
    if (blocked) { if (u.passY != null) { u.state = 'move'; u.walkT += dt; } else u.state = 'idle'; return; }
    u.slotOf = null; u.slotA = null;                         // 다시 전진한다 = 둘러싸려던 적을 놓았다 (남겨 두면 그 적이 "나를 노리는 중"으로 잘못 알고 서 있는다)
    u.state = 'move'; u.walkT += dt; u.x += u.dir * this._speed(u) * dt;
  };

  /* 집결 대열: 유닛이 맡은 자리(u.hold = { c 열, r 줄 })로 걸어가 선다. 자리는 서로 다르므로 겹치지 않는다.
     싸우러 나갔다 돌아와도 같은 자리로 온다(그 사이 자리는 비워 둔다). 쓰러지면 자리가 풀린다 */
  P._holdStep = function (u, dt) {
    var H = CONFIG.HOLD, R = this.rows;
    if (!u.hold || u.hold.r >= R.length) u.hold = this._pickHold(u);
    var tx = this.frontX - u.hold.c * H.col, ty = this.laneY + R[u.hold.r], dx = tx - u.x, dy = ty - u.y, d = Math.hypot(dx, dy);
    u.slotOf = null; u.slotA = null; u.passY = null; u.blockT = 0;
    if (d < 1.5) { u.x = tx; u.y = ty; u.state = 'idle'; this._look(u, u.dir); return; }   // 자리에 서면 적이 오는 쪽을 본다
    var step = Math.min(d, this._speed(u) * dt); u.x += dx / d * step; u.y += dy / d * step;
    u.state = 'move'; u.walkT += dt;
  };
  /* 빈 대열 자리 고르기: 역할에 맞는 가장 앞 열에서, 지금 서 있는 줄에 가까운 줄부터 */
  P._pickHold = function (u) {
    var H = CONFIG.HOLD, R = this.rows, L = this.units, taken = {}, i;
    for (i = 0; i < L.length; i++) { var o = L[i]; if (o !== u && o.side === 0 && o.state !== 'dead' && o.hold) taken[o.hold.c + ',' + o.hold.r] = 1; }
    var c0 = !u.act ? H.support : u.rangePx >= 80 ? H.ranged : 0, order = R.map(function (v, k) { return k; }), ly = this.laneY;
    order.sort(function (a, b) { return Math.abs(ly + R[a] - u.y) - Math.abs(ly + R[b] - u.y); });
    for (var c = c0; c < c0 + 40; c++) for (i = 0; i < order.length; i++) if (!taken[c + ',' + order[i]]) return { c: c, r: order[i] };
    return { c: c0, r: order[0] };
  };

  /* 지금 걷는 속도(px/초): 가속이 걸려 있으면 hasteMul배 */
  P._speed = function (u) { var h = u.buffs.haste; return u.speedPx * (h && h.until > this.time ? CONFIG.SKILL.hasteMul : 1); };

  /* 바라보는 쪽을 바꾼다 (d: 1 오른쪽, -1 왼쪽). 걷는 방향(u.dir)은 그대로 */
  P._look = function (u, d) { this._faceVec(u, d, 0, true); };
  /* 화면에서의 방향 (sx, sy) 쪽을 바라본다: 8방향 중 가장 가까운 그림 (원작 스프라이트는 5방향 + 좌우 반전).
     u.oct = 0 오른쪽, 2 아래, 4 왼쪽, 6 위. 방향이 떨리지 않게 — 지금 방향에서 30° 넘게 벗어났고, 마지막으로 바꾼 지 0.15초가 지났을 때만 바꾼다 (force 면 바로) */
  P._faceVec = function (u, sx, sy, force) {
    if (!sx && !sy) return;
    var a = Math.atan2(sy, sx), o = Math.round(a / (Math.PI / 4)) & 7; if (o === u.oct) return;
    if (!force && u.oct != null) { var diff = Math.abs(a - u.oct * Math.PI / 4); if (diff > Math.PI) diff = 2 * Math.PI - diff; if (diff < Math.PI / 6 || this.time - (u.octT || -9) < 0.15) return; }
    u.oct = o; u.octT = this.time; if (o !== 2 && o !== 6) u.lookDir = o < 2 || o > 6 ? 1 : -1;
    var ux = Math.cos(o * Math.PI / 4), uy = Math.sin(o * Math.PI / 4);
    u.face(ux / 64 + uy / 32, -ux / 64 + uy / 32);           // 화면 방향 → 타일 좌표 방향 (Unit.face 의 역변환: 화면 x = (dx − dy) × 32, 화면 y = (dx + dy) × 16)
  };

  /* 에워싸기와 우회: 근접 유닛 u가 적 tgt에게 다가간다.
     적 둘레를 slots개의 자리(각도)로 나누고, 지금 내 위치에서 가장 가까운 빈자리를 하나 맡는다(u.slotA). 앞자리가 차 있으면
     옆·뒤 자리를 맡게 되므로 길이 막혀도 돌아 들어가 사방에서 친다. 가는 길에는 적 몸을 뚫지 않고 둘레를 따라 돈다.
     자리가 하나도 없으면 그 적은 잠시 두고(skip) 위아래로 비켜서 지나간다 → 다음 적이나 기지로 간다 */
  P._approach = function (u, tgt, dt) {
    var S = CONFIG.SURROUND, R = this.rows, lo = this.laneY + R[0] - 14, hi = this.laneY + R[R.length - 1] + 14, r = u.rangePx * 0.85;
    u.apT = this.time;                                       // 지금 이 적에게 다가가는 중이라는 표시 (_besieged가 본다)
    if (u.slotOf !== tgt.uid || u.slotA == null) { u.slotOf = tgt.uid; u.slotA = this._pickSlot(u, tgt, r, lo, hi); u.slotAt = null; u.slotT = 0; }
    if (this._dist(u, tgt) <= u.rangePx) u.slotT += dt;      // 이미 닿는 거리인데도 자리를 못 찾고 도는 시간만 잰다
    if (u.slotA == null) {                                   // 둘레가 꽉 찼다 → 이 적은 건너뛰고 돌아서 간다
      u.skipUid = tgt.uid; u.skipUntil = this.time + S.skipSec; u.slotOf = null;
      var side = u.y >= tgt.y ? 1 : -1, py = tgt.y + side * S.detour; if (py < lo || py > hi) py = tgt.y - side * S.detour;
      u.passY = Math.max(lo, Math.min(hi, py)); u.passT = 0; u.state = 'idle'; return;
    }
    var ang = u.slotA * 2 * Math.PI / S.slots, sx = tgt.x + Math.cos(ang) * r, sy = tgt.y + Math.sin(ang) * r / S.yScale;
    var dx = sx - u.x, dy = sy - u.y, d = Math.hypot(dx, dy);
    if (d < 3 || u.slotT > 2.5) { u.slotAt = tgt.uid; u.state = 'idle'; return; }   // 자리에 도착 (너무 오래 걸리면 지금 자리에서 싸운다). 이후로는 이 적을 상대로 다시 움직이지 않는다
    var vx = dx / d, vy = dy / d;
    // 적 몸 가까이로는 들어가지 않는다: 안쪽이면 바깥으로 미는 힘을 더해 둘레를 따라 돌게 한다
    var tx = u.x - tgt.x, ty = (u.y - tgt.y) * S.yScale, td = Math.hypot(tx, ty) || 1;
    if (td < r * 0.9) { var out = (r * 0.9 - td) / (r * 0.9) * 2.5; vx += tx / td * out; vy += ty / td * out; }
    var v = Math.hypot(vx, vy) || 1, step = Math.min(d, this._speed(u) * dt);
    u.x += vx / v * step; u.y = Math.max(lo, Math.min(hi, u.y + vy / v * step));
    u.state = 'move'; u.walkT += dt; u.blockT = 0; u.passY = null;
  };

  /* 둘러싸이는 쪽의 이동: 가장 가까운 적에게 곧장, 내 사거리에 닿을 때까지만 (닿으면 다음 틱부터 공격한다).
     서서 기다리기만 하면 사거리가 짧은 유닛(무도가·격투가 42px)이 사거리가 긴 적(49px)에게 맞기만 하고 못 때리는 일이 생긴다 */
  P._stepToward = function (u, tgt, dt) {
    var R = this.rows, lo = this.laneY + R[0] - 14, hi = this.laneY + R[R.length - 1] + 14, dx = tgt.x - u.x, dy = tgt.y - u.y, d = Math.hypot(dx, dy) || 1;
    var step = Math.min(this._speed(u) * dt, Math.max(0, this._dist(u, tgt) - u.rangePx + 1));
    if (step <= 0) { u.state = 'idle'; return; }
    u.x += dx / d * step; u.y = Math.max(lo, Math.min(hi, u.y + dy / d * step));
    u.state = 'move'; u.walkT += dt;
  };

  /* 내가 둘러싸이는 쪽인가: 나를 둘러싸려고 자리를 맡은(slotOf = 나) 적이 가까이에 있다.
     두 근접 유닛이 마주치면 먼저 움직인 쪽이 상대 둘레에 자리를 잡고, 상대는 이 판정으로 제자리를 지킨다 */
  /* 몸동작 기술 (CONFIG.BODY_TECH): 아군만. 쓸 때 유닛 위에 이름이 잠깐 뜬다 */
  P._bodyTech = function (u) {
    var B = CONFIG.BODY_TECH, T = this.time, self = this, L = bodyTechs(u.t); if (!L.length) return;
    for (var i = 0; i < L.length; i++) { var a = L[i], c = B[a.name];
      if (a.name === '방패 막기') {
        var sb = u.buffs.shield, on = u.hp <= u.maxHp * c.hpBelow;
        if (!on && u.blocking) on = !(u.hp >= u.maxHp * c.hpRelease && this.units.filter(function (o) { return o.side !== u.side && o.state !== 'dead' && Math.hypot(o.x - u.x, o.y - u.y) <= c.near; }).length < c.foes);   // 켜진 뒤에는 체력 70% 이상 + 둘레의 적 3기 미만이어야 풀린다
        if (on && (!sb || sb.block || sb.until <= T)) u.buffs.shield = { arm: -1, block: 1, until: T + 0.5 };   // 다른 방어막(파운틴 베리어 등)이 걸려 있으면 그쪽이 더 세므로 덮지 않는다. arm -1 = 원본 방패 막기 배수 ×2
        if (on && !u.blocking) this._say(u.x, u.y - u.headY - 10, a.name, '#ffd36e');
        u.blocking = on;
      } else if (a.name === '창 돌리기' && T >= (u.spinAt || 0) && u.state !== 'dead') {
        var r = a.range * CONFIG.RANGE_SCALE, near = this.units.filter(function (o) { return o.side !== u.side && o.state !== 'dead' && o.t.fly !== 2 && Math.hypot(o.x - u.x, o.y - u.y) <= r; });
        if (near.length < c.foes) continue;
        var keep = u.act; u.act = a; near.forEach(function (o) { self._damage(o, self.rules.damage(u, o, self.rng)); }); u.act = keep;
        u.hp = Math.max(1, u.hp - (a.hpCost || 0)); u.spinAt = T + c.cool;
        if (a.arm >= 0) this._addEffect(u.x, u.y - u.headY * 0.4, a.arm, 0); this._play(a.snd, 0.5); this._say(u.x, u.y - u.headY - 10, a.name, '#ffd36e');
      } }
  };
  P._besieged = function (u) {
    var L = this.units;
    for (var i = 0; i < L.length; i++) { var o = L[i]; if (o.side === u.side || o.state === 'dead' || o.slotOf !== u.uid || Math.hypot(o.x - u.x, o.y - u.y) >= CONFIG.SURROUND.holdDist) continue;   // 코앞까지 온 적만 — 멀리서 오는 적은 서서 기다리지 않고 마주 다가간다
      // 실제로 오고 있거나(방금 _approach 함) 이미 닿는 거리에 있는 적만 친다. 멈춤에 걸렸거나 기지를 치러 가 버린 적의 예전 표시는 무시 —
      // 그런 적을 기다리며 서 있으면 "적을 만났는데 다가가지 않고 멈추는" 현상이 된다
      if (o.stunUntil > this.time) continue;
      if (this.time - o.apT < 0.3 || this._dist(o, u) <= o.rangePx) return true; }
    return false;
  };

  /* 적 tgt 둘레에서 u가 맡을 자리(각도 번호)를 고른다: 지금 위치에서 가까운 각도부터, 같은 편이 이미 맡지 않았고 전투 줄 안에 있는 자리. 없으면 null */
  P._pickSlot = function (u, tgt, r, lo, hi) {
    var S = CONFIG.SURROUND, n = S.slots, L = this.units, taken = {}, i;
    for (i = 0; i < L.length; i++) { var o = L[i]; if (o !== u && o.side === u.side && o.state !== 'dead' && o.slotOf === tgt.uid && o.slotA != null) taken[o.slotA] = 1; }
    var bearing = Math.atan2((u.y - tgt.y) * S.yScale, u.x - tgt.x), best = null, bd = Infinity;
    for (i = 0; i < n; i++) { if (taken[i]) continue; var a = i * 2 * Math.PI / n, y = tgt.y + Math.sin(a) * r / S.yScale; if (y < lo || y > hi) continue;
      var diff = Math.abs(Math.atan2(Math.sin(a - bearing), Math.cos(a - bearing))); if (diff < bd) { bd = diff; best = i; } }
    return best;
  };

  /* 두 유닛 사이의 "닿는 거리". 원거리는 가로 거리만, 근접은 세로까지 넣은 2차원 거리 (적의 위·아래·뒤에서도 닿으면 친다) */
  P._dist = function (u, o) { var dx = Math.abs(o.x - u.x); return u.rangePx < 80 ? Math.hypot(dx, (o.y - u.y) * CONFIG.SURROUND.yScale) : dx; };

  /* 세로로 y 쪽을 향해 step만큼 옮긴다 (전투 줄 범위 안에서) */
  P._shiftRow = function (u, y, step) {
    var R = this.rows, lo = this.laneY + R[0], hi = this.laneY + R[R.length - 1], d = y - u.y;
    var ny = Math.max(lo, Math.min(hi, u.y + Math.max(-step, Math.min(step, d)))), C = CONFIG, L = this.units;
    // 옮겨 갈 자리에 같은 편이 이미 서 있으면 그대로 둔다 (포개지지 않게)
    for (var i = 0; i < L.length; i++) { var o = L[i]; if (o === u || o.air || u.air || o.side !== u.side || o.state === 'dead') continue;
      if (Math.abs(o.x - u.x) < C.UNIT_GAP * 0.7 && Math.abs(o.y - ny) < C.ROW_NEAR && Math.abs(o.y - u.y) >= Math.abs(o.y - ny)) return; }
    u.y = ny;
  };

  /* 같은 줄, 가는 방향 바로 앞(UNIT_GAP 안)에 나를 막는 같은 편 유닛이 있는가.
     나보다 reach가 긴 유닛(원거리·지원)은 막는 것으로 치지 않는다 → 전사는 궁수·마법사·성직자를 지나쳐 앞줄로 나간다.
     정확히 같은 자리면 먼저 나온 유닛이 앞 */
  P._blockedAhead = function (u) {
    var C = CONFIG, L = this.units; if (u.air) return false;   // 공중 유닛은 막히지 않는다
    for (var i = 0; i < L.length; i++) { var o = L[i]; if (o === u || o.air || o.side !== u.side || o.state === 'dead' || Math.abs(o.y - u.y) >= C.ROW_NEAR) continue;
      if (o.reach > u.reach + 1) continue;
      var ahead = (o.x - u.x) * u.dir; if ((ahead > 0 && ahead < C.UNIT_GAP) || (ahead === 0 && o.uid < u.uid)) return true; }
    return false;
  };

  /* 같은 줄 앞쪽(UNIT_GAP × PASS_LOOK 안)에 나보다 느리게 "걷고 있는" 같은 편이 있는가. 서서 싸우는 유닛은 해당 없음(그건 줄 서기·에워싸기가 맡는다) */
  P._slowAhead = function (u) {
    var C = CONFIG, L = this.units, mine = this._speed(u); if (u.air) return false;
    for (var i = 0; i < L.length; i++) { var o = L[i]; if (o === u || o.air || o.side !== u.side || o.state !== 'move' || Math.abs(o.y - u.y) >= C.ROW_NEAR) continue;
      if (o.reach > u.reach + 1) continue;
      var ahead = (o.x - u.x) * u.dir; if (ahead > 0 && ahead < C.UNIT_GAP * C.PASS_LOOK && this._speed(o) < mine * 0.9) return true; }
    return false;
  };

  /* 추월할 줄 고르기: 지금 줄에서 가까운 순서로, 내 옆과 바로 앞에 나를 막을 같은 편이 없는 줄. 없으면 null */
  P._freeRow = function (u) {
    var C = CONFIG, L = this.units, self = this, rows = this.rows.map(function (r) { return self.laneY + r; })
      .filter(function (y) { return Math.abs(y - u.y) >= C.ROW_NEAR; }).sort(function (a, b) { return Math.abs(a - u.y) - Math.abs(b - u.y); });
    for (var k = 0; k < rows.length; k++) { var y = rows[k], free = true;
      for (var i = 0; i < L.length && free; i++) { var o = L[i]; if (o === u || o.air || o.side !== u.side || o.state === 'dead' || Math.abs(o.y - y) >= C.ROW_NEAR || o.reach > u.reach + 1) continue;
        var ahead = (o.x - u.x) * u.dir; if (ahead > -C.UNIT_GAP * 0.7 && ahead < C.UNIT_GAP) free = false; }
      if (free) return y; }
    return null;
  };

  /* 포개짐 풀기: 같은 편 둘이 거의 같은 자리에 서 있으면(주로 사거리 끝에서 멈춘 원거리 유닛) 나중에 온 쪽이 위아래로 조금씩 비켜 선다.
     전투 줄 끝이라 더 비킬 데가 없으면 뒤로 물러난다 */
  P._separate = function (dt) {
    var C = CONFIG, L = this.units, R = this.rows, lo = this.laneY + R[0], hi = this.laneY + R[R.length - 1];
    for (var i = 0; i < L.length; i++) { var u = L[i]; if (u.state === 'dead' || u.air) continue;   // 공중 유닛은 땅 위 유닛과 겹쳐도 된다
      for (var j = 0; j < L.length; j++) { var o = L[j]; if (o === u || o.air || o.side !== u.side || o.state === 'dead' || o.uid > u.uid) continue;
        var dy = u.y - o.y; if (Math.abs(u.x - o.x) >= 14 || Math.abs(dy) >= 12) continue;
        var dir = dy !== 0 ? (dy > 0 ? 1 : -1) : (u.uid % 2 ? 1 : -1), ny = u.y + dir * 30 * dt;
        if (ny < lo || ny > hi) u.x -= u.dir * 20 * dt; else u.y = ny;
        break; } }
  };

  /* 맞은편 유닛 중 가장 가까운 것 (_dist 기준) */
  P._nearestFoe = function (u) {
    var best = null, bd = Infinity, L = this.units;
    for (var i = 0; i < L.length; i++) { var o = L[i]; if (o.side === u.side || o.state === 'dead') continue;
      if (u.skipUid === o.uid && this.time < u.skipUntil) continue;   // 둘레가 꽉 차서 건너뛰기로 한 적
      if (o.air && !u.air && u.rangePx < 80) continue;               // 지상 근접 유닛은 공중 유닛을 때리지 못한다 (원거리·마법·공중 유닛만 가능)
      var d = this._dist(u, o); if (d < bd) { bd = d; best = o; } }
    return best;
  };

  /* 카메라: 손으로 움직인 직후가 아니면 전선(아군 맨 앞과 적 맨 앞 사이)을 부드럽게 따라간다 */
  P._updateCamera = function (dt) {
    var C = CONFIG, W = this.W, a = -Infinity, e = Infinity, L = this.units, target;
    if ((this.drag && !this.drag.slots && !this.drag.btn) || this.time < this.manualUntil) { this.camGoal = null; this._clampCam(); return; }   // 손으로 움직이면 마법 지점 비추기도 그만둔다
    if (this.camGoal) { if (this.time >= this.camGoal.until) this.camGoal = null; else { this.cam.x += (this.camGoal.x - this.cam.x) * Math.min(1, dt * C.CAM.skillSpeed); this._clampCam(); return; } }
    for (var i = 0; i < L.length; i++) { var o = L[i]; if (o.state === 'dead') continue; if (o.side === 0) a = Math.max(a, o.x); else e = Math.min(e, o.x); }
    if (a === -Infinity) target = e < W * 0.9 ? e - W * 0.6 : 0;             // 아군이 없다: 적이 성 근처에 올 때까지는 성을 비춘다
    else if (e - a < W * 0.8) target = (a + e) / 2 - W / 2;                    // 맞붙었다: 두 전선의 가운데
    else target = a - W * 0.35;                                               // 아군만 나아가는 중: 아군 맨 앞을 조금 앞서 본다
    this.cam.x += (target - this.cam.x) * Math.min(1, dt * C.CAM.follow);
    this._clampCam();
  };
  P._clampCam = function () { this.cam.x = Math.max(0, Math.min(CONFIG.WORLD_W - this.W, this.cam.x)); };
  /* 손으로 카메라를 옮김 (끌기·방향키·진행 막대 누르기). 잠시 동안 자동 따라가기를 멈춘다 */
  P.panTo = function (x) { this.camGoal = null; this.cam.x = x; this._clampCam(); this.manualUntil = this.time + CONFIG.CAM.manualSec; };

  /* 타격 순간: 근접은 바로 피해, 원거리(행동에 발사체 arm이 있음)는 발사체를 날린다 */
  P._strike = function (u) {
    var tgt = u.tgt, R = this.rules;
    if (tgt === 'base') { this._hitBase(R.attackValue(u)); return; }
    if (tgt && tgt.isFort) { if (!tgt.dead) this._hitFort(tgt, R.attackValue(u)); return; }
    if (!tgt || tgt.state === 'dead' || tgt.side === u.side) return;
    var dmg = R.damage(u, tgt, this.rng), arm = u.act.arm, def = arm >= 0 ? this.data.fx.arms[arm] : null;
    if (def) this.shots.push({ x: u.x + u.dir * 14, y: u.y - u.headY * 0.6, tgt: tgt, dmg: dmg, arm: arm, def: def, dir: u.dir, t0: this.time, speed: 380 });
    else { this._damage(tgt, dmg);
      // 중독 (원본 FUN_004ac6f0: 행동 종류 +0x3C == 1 = 전갈의 포이즌 테일 — 맞은 유닛에 중독, 지속 = 행동 +0x3E 틱. 면역 유닛(종류 +0x54) 제외). 피해는 _updateUnit
      if (u.act.type === 1 && tgt.state !== 'dead' && !tgt.t.immune) { if (!(tgt.buffs.poison && tgt.buffs.poison.until > this.time)) this._say(tgt.x, tgt.y - tgt.headY - 6, '중독', '#9be36a'); tgt.buffs.poison = { until: this.time + (u.act.dur || 160) / R.tps }; } }
  };

  P._damage = function (u, dmg) {
    if (u.state === 'dead') return;
    dmg = dmg > 0 ? Math.max(1, Math.round(dmg)) : 0;        // 정수로: "마법 증폭"(×1.3) 뒤 124.80000000000001 같은 긴 소수가 그대로 뜨던 버그 (2026-11-12)
    this._say(u.x, u.y - u.headY - 6, dmg > 0 ? String(dmg) : 'miss', u.side === 1 ? '#ffe9a8' : '#ff9a8a');
    if (dmg <= 0) return;
    u.hp -= dmg;
    if (u.side === 0 && !u.act && !u.hero) u.fleeUntil = this.time + CONFIG.FLEE_SEC;   // 기본 공격이 없는 아군(성령사·사제·연금술사·소환사·공주 …)은 맞으면 아군 쪽으로 물러난다
    if (u.hp <= 0) {
      u.hp = 0; u.state = 'dead'; u.deadT = 0; u.fade = 0; u.buffs = {};
      this._removeSlots(u);                                  // 마법 유닛이면 그 유닛의 스킬 칸도 함께 없앤다 → 소환 버튼이 다시 켜진다
      this._play(u.t.snd.die, 0.7);
      if (u.side === 1) { this.kills++; this._gainXp((u.t.lv && u.t.lv.exp || 1) * Math.max(CONFIG.GROW.xpMin, 1 - CONFIG.GROW.xpFall * Math.min(this.wave, CONFIG.WAVES.length - 1))); }   // 처치 = 경험치 (원작 유닛의 경험치 값)
    }
  };

  P._hitBase = function (dmg) { var df = this.forts && this.forts[0] ? this.garDef(this.forts[0]) : 0; if (df > 0) dmg = Math.max(Math.ceil(dmg * CONFIG.GAR_DEF_MIN), dmg - df);   // 수비대의 방어 보너스만큼 덜 받는다 (그래도 원래 피해의 GAR_DEF_MIN 은 받는다)
    this.baseHp -= dmg; this.baseHit = 0.25; this._say(CONFIG.BASE.front - 50, this.laneY - 70, '-' + dmg, '#ff7a6a'); };

  /* 자폭: 조건이 맞으면 터진다 (CONFIG.BOOM). 둘레의 맞은편 유닛 모두에게 원본 공식 피해, 자신은 죽는다. true = 터졌다 */
  P._boom = function (u) {
    var B = CONFIG.BOOM, self = this, near = this.units.filter(function (o) { return o.side !== u.side && o.state !== 'dead' && Math.hypot(o.x - u.x, o.y - u.y) <= B.radius; });
    if (!(near.length >= B.min || (near.length >= 1 && u.hp <= u.maxHp * B.hp))) return false;
    var keep = u.act, a = u.boom; u.act = a;
    near.forEach(function (o) { self._damage(o, self.rules.damage(u, o, self.rng) * B.dmgMul); });
    u.act = keep; this._addEffect(u.x, u.y - 10, a.arm, 0); this._say(u.x, u.y - u.t.h - 18, a.name, u.side === 0 ? '#ffd36e' : '#ff8a7a'); this._play(a.snd, 0.9);
    this._damage(u, u.hp + 1);                              // 자신은 죽는다
    return true;
  };
  /* u 를 지금 노리고 있는 적의 수 (공격 동작 중이거나 방금 쳐서 다음 공격을 기다리는 적) */
  P._attackers = function (u) { var n = 0, L = this.units; for (var i = 0; i < L.length; i++) { var o = L[i]; if (o.side !== u.side && o.state !== 'dead' && o.tgt === u && (o.state === 'attack' || o.cd > 0)) n++; } return n; };
  /* 다친 근접 유닛 u 가 뒤에 설 아군: 가까이 있는 근접 아군 중 체력이 넉넉한(coverHp 넘는) 가장 가까운 유닛. 없으면 null (그 자리에서 싸운다) */
  P._coverFor = function (u) {
    var AI = CONFIG.AI, best = null, bd = AI.coverDist, L = this.units;
    for (var i = 0; i < L.length; i++) { var o = L[i]; if (o === u || o.side !== u.side || o.state === 'dead' || !o.act || o.rangePx >= 80 || o.hp <= o.maxHp * AI.coverHp || o.x < u.x - 40) continue;
      var d = Math.hypot(o.x - u.x, o.y - u.y); if (d < bd) { bd = d; best = o; } }
    return best;
  };
  /* 적 u 가 때릴 벙커: 유닛이 들어 있고 부서지지 않은 벙커 중, u 와 같은 쪽(위쪽 벙커 = 전투 줄 위쪽 절반, 아래쪽 = 아래쪽 절반)이고 가로로 사거리 안에 든 것. 이미 지나쳐 간 벙커는 돌아보지 않는다 */
  P._fortFor = function (u) {
    for (var i = this.forts.length - 1; i >= 1; i--) { var F = this.forts[i]; if (F.dead || !F.garrison.length) continue;
      if ((F.at === 'bottom') !== (u.y >= this.laneY)) continue;
      var dx = u.x - (F.x + 30); if (dx >= -60 && dx <= u.rangePx) return F; }
    return null;
  };
  /* 벙커가 맞았다: 수비대의 방어 보너스만큼 덜 받는다. 체력이 0이면 부서지고 안의 유닛이 밖으로 나온다 */
  P._hitFort = function (F, dmg) {
    var df = this.garDef(F), self = this; if (df > 0) dmg = Math.max(Math.ceil(dmg * CONFIG.GAR_DEF_MIN), dmg - df);
    F.hp -= dmg; F.hit = 0.25; this._say(F.x + 20, F.y - 60, '-' + dmg, '#ff7a6a');
    if (F.hp > 0) return;
    F.hp = 0; F.dead = true;
    F.garrison.forEach(function (m) { var o = self.spawn(m.r.id, 0); o.x = F.x + 20; });
    F.garrison = []; F.weapons = { 0: { phase: -1, c: 0 }, 4: { phase: -1, c: 0 } }; if (this.selFort === F) this.selFort = null;
    this._say(F.x, Math.min(F.y, this.laneY) - 150, F.name + ' 파괴 — 수비대가 밖으로 나왔습니다', '#ff8a7a'); this.flash = 0.15;
  };
  /* 떠오르는 글자 하나 (피해량, 회복량, 스킬 이름 …) */
  P._say = function (x, y, s, col) { this.texts.push({ x: x, y: y, s: s, t0: this.time, col: col }); };

  /* 발사체: 대상을 향해 날아가 닿으면 피해 + 명중 이펙트 */
  P._updateShots = function (dt) {
    var keep = [];
    for (var i = 0; i < this.shots.length; i++) {
      var s = this.shots[i], t = s.tgt, tx = t.x, ty = t.y - t.headY * 0.5, dx = tx - s.x, dy = ty - s.y, d = Math.hypot(dx, dy), step = s.speed * dt;
      if (d <= step || t.state === 'dead') {
        if (t.state !== 'dead') { this._damage(t, s.dmg); if (s.def.hit.length) this._addEffect(tx, ty, s.arm, 0); }
        continue;
      }
      s.x += dx / d * step; s.y += dy / d * step; s.ang = Math.atan2(dy, dx); keep.push(s);
    }
    this.shots = keep;
  };

  P._addEffect = function (x, y, arm, delay) {
    var d = this.data.fx.arms[arm], fr = d && (d.hit.length ? d.hit : d.fly.length ? d.fly : d.seq);   // seq = 순간이동 이펙트의 틱 순서표
    if (fr && fr.length) this.effects.push({ x: x, y: y, f: fr, t0: this.time + (delay || 0), add: !d.dir });
  };

  P._play = function (id, vol) { if (this.soundOn && id != null && id >= 0) this.sfx.play(id, vol); };

  /* ───────────────────────── 6. draw ───────────────────────── */
  P.draw = function () {
    var ctx = this.ctx, W = this.W, H = this.H;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#0b0d12'; ctx.fillRect(0, 0, W, H);
    if (this.screen === 'loading') { MWE.drawLoading(ctx, W, H, this.assets, this.sfx); return; }   // 진행률 바 (render/assets.js)

    this._drawGround();
    // 전장 층: 여기서부터는 전장 좌표로 그린다 (카메라만큼 왼쪽으로 밀고, 아래 패널 영역은 잘라낸다)
    var camX = Math.round(this.cam.x), vx0 = camX - 120, vx1 = camX + W + 120, i;
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, H - this.hudH); ctx.clip(); ctx.translate(-camX, 0);
    this._drawBases();
    // 유닛: 화면에 보이는 것만, 아래쪽(y가 큰) 유닛이 위에 그려지도록 정렬
    var L = this.units.filter(function (u) { return u.x > vx0 && u.x < vx1; }).sort(function (a, b) { return a.y - b.y; });
    for (i = 0; i < L.length; i++) this._drawUnit(L[i]);
    this._drawForts('bottom');                               // 아래쪽 벙커: 유닛보다 앞에 있다
    for (i = 0; i < this.shots.length; i++) this._drawShot(this.shots[i]);
    for (i = 0; i < this.effects.length; i++) this._drawEffect(this.effects[i]);
    this._drawTexts();
    ctx.restore();
    this._drawAim();                                         // 조준 중: 시전 거리 띠 + 반경 원
    this._drawBaseSel();
    this._drawSelectionOverlay();                            // 선택 링 위의 [회수] 버튼 — 유닛 정렬 루프 밖(위에 그려지는 유닛에 가리지 않게), 화면 좌표
    this._drawBanner();
    if (this.flash > 0) { ctx.fillStyle = 'rgba(255,240,200,' + (this.flash * 0.9) + ')'; ctx.fillRect(0, 0, W, H - this.hudH); }
    this._drawHud();
    if (this.screen === 'play' && !this.cards && !this.modal) { this._drawInfo(); this._drawSkillInfo(); }   // 소환 버튼·스킬 칸을 길게 누르는 동안의 설명 카드
    if (this.screen !== 'play') this._drawOverlay();
    else if (this.cards) this._drawCards();
    if (this.screen === 'play' && this.modal === 'aff') this._drawAff();   // 유닛 상성 모달 (게임은 멈춰 있다)
  };

  /* 바닥 무늬 만들기: 원본 맵에서 장애물 없는 평지 한 조각(GW × GH)을 떠 온다.
     원본 타일은 가로 64 · 세로 32 간격의 마름모라서, 그 배수 크기로 뜬 조각은 이어 붙여도 타일 모양이 어긋나지 않는다.
     (맵을 그대로 깔면 2000px 안에 절벽·맵 가장자리가 들어와서, 평지 조각을 되풀이해 긴 전장을 만든다) */
  var GW = 448, GH = 192;
  P._makeGround = function () {
    // 이미 있으면 같은 캔버스에 다시 그린다 (새로 만들지 않는다) — 아이폰 WebKit 은 메모리가 모자라면 다시 그리지 않는 캔버스의 내용을 비우므로, 주기적으로 다시 그려 복구한다 (_frame)
    var map = this.map, c = map.t2w(map.arena[0], map.arena[1]), cv = this.ground || document.createElement('canvas'); if (cv.width !== GW) cv.width = GW; if (cv.height !== GH) cv.height = GH;
    var g = cv.getContext('2d'); g.imageSmoothingEnabled = false; g.clearRect(0, 0, GW, GH);
    this.terrain.draw(g, { x: Math.round(c[0] / 64) * 64 - GW / 2, y: Math.round(c[1] / 32) * 32 - GH / 2 }, GW, GH);
    this.ground = cv; this._groundAt = this.time;
  };

  /* 배경: 평지 조각을 카메라에 맞춰 이어 깔고, 전투 줄을 살짝 어둡게 표시 */
  P._drawGround = function () {
    var ctx = this.ctx, W = this.W, gh = this.H - this.hudH, rows = this.rows, top = this.laneY + rows[0] - 40, bot = this.laneY + rows[rows.length - 1] + 30;
    if (!this.ground) return;
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, gh); ctx.clip();
    for (var x = -(Math.round(this.cam.x) % GW); x < W; x += GW) for (var y = 0; y < gh; y += GH) ctx.drawImage(this.ground, x, y);
    var g = ctx.createLinearGradient(0, top, 0, bot);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.5, 'rgba(0,0,0,.2)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, top, W, bot - top);
    ctx.restore();
  };

  /* 아군 기지(왼쪽 성)와 적 출구(오른쪽 마굴): 원본 건물 그림. 그림의 기준점(ax, ay = 땅에 닿는 앞쪽 모서리)을 전투 줄 바로 아래에 맞춘다 */
  P._drawBases = function () {
    var C = CONFIG, D = this.bld, B = D.base, EN = C.ENEMIES[this.enemy], L = D[EN.lair] || D.lair, gy = this.laneY + 44;
    if (B) { var sh = this.baseHit > 0 ? Math.round(Math.sin(this.time * 90) * 2) : 0, F0 = this.forts[0];   // 맞으면 살짝 흔들린다
      if (this.selFort === F0) this._drawOutline(B, C.BASE.x + sh, gy);   // 고른 건물: 윤곽을 따라 초록 선
      this._drawBuilding(B, C.BASE.x + sh, gy, F0); }
    this._drawForts('top');                                  // 위쪽 벙커는 유닛보다 먼저(뒤에), 아래쪽 벙커는 유닛을 다 그린 뒤(앞에) — draw()
    if (L) { var lx = C.WORLD_W - C.LAIR.back, lp = D.pics[L.pic], ctx = this.ctx;
      this._drawBuilding(L, lx, gy);
      // 마굴 입구의 으스스한 빛 (가산 합성으로 깜박임)
      var gx = lx - lp[2] * 0.16, gcy = gy - lp[3] * 0.30, g = ctx.createRadialGradient(gx, gcy, 2, gx, gcy, 46);
      g.addColorStop(0, 'rgba(' + EN.glow + ',' + (0.30 + 0.16 * Math.sin(this.time * 3)) + ')'); g.addColorStop(1, 'rgba(' + EN.glow + ',0)');
      ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = g; ctx.fillRect(gx - 46, gcy - 46, 92, 92); ctx.globalCompositeOperation = 'source-over'; }
  };

  /* 벙커 그리기: at = 'top' 또는 'bottom' 인 것만 */
  P._drawForts = function (at) {
    for (var fi = 1; fi < this.forts.length; fi++) { var F = this.forts[fi], ctx = this.ctx; if ((F.at || 'top') !== at) continue;
      if (F.dead) { ctx.globalAlpha = 0.3; var o0 = this._bldOrigin(F.B, F.x, F.y); this._pic(F.B.pic, o0[0], o0[1]); ctx.globalAlpha = 1; continue; }   // 부서진 벙커: 흐린 터만
      if (F.hit > 0) F.hit = Math.max(0, F.hit - 1 / 60);
      var sh = F.hit > 0 ? Math.round(Math.sin(this.time * 90) * 2) : 0;
      if (this.selFort === F) this._drawOutline(F.B, F.x + sh, F.y);
      this._drawBuilding(F.B, F.x + sh, F.y, F);
      if (F.hp < F.maxHp) { var p = this.bld.pics[F.B.pic], o = this._bldOrigin(F.B, F.x, F.y), bw = 46, bx = Math.round(o[0] + F.B.center[0] - bw / 2), by = Math.round(o[1] - p[5] - 8), k = F.hp / F.maxHp;   // 체력 막대 (맞았을 때부터)
        ctx.fillStyle = 'rgba(0,0,0,.75)'; ctx.fillRect(bx - 1, by - 1, bw + 2, 6); ctx.fillStyle = k > 1 / 3 ? '#3fbf5a' : '#e0584a'; ctx.fillRect(bx, by, Math.round(bw * k), 4); } }
  };

  /* 고른 건물의 윤곽선: 건물 그림의 실루엣을 원작 선택 원과 같은 초록으로 칠해 여덟 방향으로 1px씩 밀어 먼저 그린다 → 건물을 그리면 가장자리에 초록 선만 남는다.
     실루엣은 한 번 만들어 둔다. (원본의 건물 선택 그리기는 아직 해독하지 않았다 — 사용자 기억에 따른 표현) */
  P._drawOutline = function (b, x, y) {
    var p = this.bld.pics[b.pic], o = this._bldOrigin(b, x, y), ctx = this.ctx, k, r = 1;   // 원작 화면(사용자 캡쳐 2026-11-13)처럼 가는 1px 선, 깜박이지 않는다
    if (!this._sil || this._sil.pic !== b.pic) { var cv = document.createElement('canvas'); cv.width = p[2]; cv.height = p[3]; var c2 = cv.getContext('2d');
      c2.drawImage(this.assets.get('defense'), p[0], p[1], p[2], p[3], 0, 0, p[2], p[3]); c2.globalCompositeOperation = 'source-in'; c2.fillStyle = '#58e86a'; c2.fillRect(0, 0, p[2], p[3]); this._sil = { pic: b.pic, cv: cv }; }
    var x0 = Math.round(o[0] - p[4]), y0 = Math.round(o[1] - p[5]), D = [[-r, 0], [r, 0], [0, -r], [0, r], [-r, -r], [r, -r], [-r, r], [r, r]];
    for (k = 0; k < D.length; k++) ctx.drawImage(this._sil.cv, x0 + D[k][0], y0 + D[k][1]);
  };

  /* 건물 하나: 본체 + 깃발. (x, y) = 건물 기준점(땅에 닿는 앞쪽 모서리)의 전장 좌표.
     깃발은 원본처럼 주인이 있는 건물에 늘 걸려 있고 8장을 돌려 가며 펄럭인다 (flag.mwb, 자리 = BuildingData +0x46~+0x4C, 분석 8-35) */
  P._drawBuilding = function (b, x, y, fort) {
    var D = this.bld, p = D.pics[b.pic], o = this._bldOrigin(b, x, y), k = Math.floor(this.time * 8) % b.flagFrames.length;
    this._pic(b.pic, o[0], o[1]);
    if (fort) { this._drawWeapons(b, o, fort.weapons); this._drawOccupants(b, o, fort);
      // 방어 보너스 표시: 건물 위에 원작 상태 아이콘의 방패(unitState.spr 3번) + 숫자. 성에만 의미가 있다 — 성 꼭대기 오른쪽([퇴각] 팻말을 피해서)
      var gd = this.garDef(fort), HB = root.MW && root.MW.hpbar, isBase = fort === this.forts[0];
      if (gd > 0 && HB && HB.states) { var sf = HB.states[3], ix = Math.round(o[0] + b.center[0] + (isBase ? 44 : 28)), iy = Math.round(o[1] - p[5] + (isBase ? 26 : -14)), ctx = this.ctx; ctx.drawImage(this.assets.get('hpbar'), sf[0], sf[1], sf[2], sf[3], ix, iy, sf[2], sf[3]);
        ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.9)'; ctx.strokeText('+' + gd, ix + 20, iy + 10); ctx.fillStyle = '#8fe89a'; ctx.fillText('+' + gd, ix + 20, iy + 10); } }
    for (var i = 0; i < b.flags.length; i++) this._pic(b.flagFrames[(k + i * 3) % b.flagFrames.length], o[0] + b.flags[i][0], o[1] + b.flags[i][1]);
  };
  /* 건물 안의 수비대: 원작처럼 건물 가장자리의 자리(BuildingData 의 자리 줄 4개, 분석 8-44)에 원판 + 유닛의 작은 실루엣을 세운다.
     자리: 앞쪽 두 줄(A·B)의 보이는 자리를 모서리에서부터 번갈아 채우고, 모자라면 그 앞으로 한 줄 더 선다 (_fortSlots).
     (원본에서 수비대 실루엣을 그리는 함수 자체는 아직 못 찾았다 — 자리 좌표와 간격은 원본 값, 원판·실루엣의 모양은 사용자가 준 원작 화면을 따랐다) */
  P._fortSlots = function (fort) {
    if (fort._slots) return fort._slots; var b = fort.B, R = b.rows || [], o = this._bldOrigin(b, fort.x, 0), per = Math.ceil(fort.cap / 2), V = [], k;
    // 앞쪽 두 줄(A·B)의 모서리를 따라 한 줄로 선다: 줄마다 수용 인원의 절반씩, 원본 자리 줄의 처음 칸부터 마지막 칸까지를 고르게 나눠서
    // (원본은 성 3칸 + 3칸, 디펜스는 8명이라 4명 + 4명 — 같은 구간에 조금 촘촘히). 가운데 모서리에서부터 번갈아 채운다. 뒤쪽 줄(C·D)은 건물에 가려져 쓰지 않는다
    for (k = 0; k < per; k++) [R[0], R[1]].forEach(function (r) { if (!r) return; var t = per > 1 ? k * (r[2] - 1) / (per - 1) : 0, x = r[0] + t * r[3], y = r[1] + t * r[4]; if (o[0] + x >= 12) V.push({ x: x, y: y }); });
    var out = [], rank = 0; while (V.length && out.length < fort.cap) { V.forEach(function (q) { if (out.length < fort.cap) out.push({ x: q.x, y: q.y + rank * 15 }); }); rank++; }   // (화면 밖 자리가 있어 모자라면 앞으로 한 줄 더)
    return (fort._slots = out);
  };
  P._drawOccupants = function (b, o, fort) {
    var S = this._fortSlots(fort), G = fort.garrison, ctx = this.ctx, figs = this.assets.get('figs'), L = [];
    for (var i = 0; i < G.length && i < S.length; i++) L.push({ q: S[i], m: G[i] });
    L.sort(function (p, q) { return p.q.y - q.q.y; });       // 아래쪽(앞)에 선 유닛이 위에 그려지게
    L.forEach(function (it) { var x = Math.round(o[0] + it.q.x), y = Math.round(o[1] + it.q.y);
      ctx.fillStyle = 'rgba(150,28,24,.85)'; ctx.beginPath(); ctx.ellipse(x, y, 13, 6, 0, 0, 6.3); ctx.fill();          // 원판 (원작 화면의 붉은 원판)
      ctx.strokeStyle = 'rgba(255,120,100,.7)'; ctx.lineWidth = 1; ctx.stroke();
      ctx.drawImage(figs, it.m.r.t.pid * 36, 0, 36, 43, x - 11, y - 25, 22, 26); });   // 유닛 실루엣 22×26 (27×32로 키웠다가 되돌림 — 8명이 겹쳐 보였다)                                    // 유닛 실루엣 (원작의 작은 유닛 그림, 초록)
  };
  /* 성 위의 건물 무기 (원본 FUN_004f4950의 그림 고르기 그대로):
       등급 0(마법사·장로, barm00 30장): 전개 중 = 0~9, 가동 = 10~19 위에 20~29를 겹침.  자리 = BuildingData +0x56/+0x58
       등급 4(궁수류, barm05 21장):      전개 중 = 0~4, 가동 = 4(다 선 망루) 위에 5~20을 겹침.  자리 = +0x60/+0x62/+0x64로 계산한 곳 */
  P._drawWeapons = function (b, o, W) {
    var D = this.bld, w0 = W[0], w4 = W[4];
    if (w4.phase === 0) this._pic(D.arm4[Math.min(4, w4.c)], o[0] + b.arm4[0], o[1] + b.arm4[1]);
    else if (w4.phase === 2) { this._pic(D.arm4[4], o[0] + b.arm4[0], o[1] + b.arm4[1]); this._pic(D.arm4[5 + w4.c % 16], o[0] + b.arm4[0], o[1] + b.arm4[1]); }
    if (w0.phase === 0) this._pic(D.arm0[Math.min(9, w0.c)], o[0] + b.arm0[0], o[1] + b.arm0[1]);
    else if (w0.phase === 2) { this._pic(D.arm0[10 + w0.c % 10], o[0] + b.arm0[0], o[1] + b.arm0[1]); this._pic(D.arm0[20 + w0.c % 10], o[0] + b.arm0[0], o[1] + b.arm0[1]); }
  };
  /* 건물의 "그리기 원점"(원본 좌표의 기준 — 깃발·무기 자리가 여기서부터의 거리)의 전장 좌표 */
  P._bldOrigin = function (b, x, y) { var p = this.bld.pics[b.pic]; return [x - b.ax + p[4], y - b.ay + p[5]]; };
  /* defense.png 안의 그림 한 장을 (x, y)에 원점을 맞춰 그린다 */
  P._pic = function (i, x, y) { var p = this.bld.pics[i]; this.ctx.drawImage(this.assets.get('defense'), p[0], p[1], p[2], p[3], Math.round(x - p[4]), Math.round(y - p[5]), p[2], p[3]); };

  /* 원작 선택 원 한 쪽(choice.spr): color = 0 초록 / 14 빨강 / 28 노랑 / 42 흰색, half = 0 뒤쪽 반 / 1 앞쪽 반, up = 크기를 몇 단계 키울지.
     크기 번호는 체력 바 틀과 같은 값(unitData +0xFE)을 쓴다 — 원본 FUN_004f7a80 / FUN_004f7bc0 */
  P._ring = function (u, x, y, color, half, up) {
    var HB = root.MW && root.MW.hpbar, him = this.assets.get('hpbar'); if (!HB || !HB.rings || !him) return;
    var hb = HB.units[u.t.id] || HB.units[0], sz = Math.min(6, (hb[0] || 0) + (up || 0)), f = HB.rings[color + sz * 2 + half]; if (!f) return;
    this.ctx.drawImage(him, f[0], f[1], f[2], f[3], x - f[4], y - f[5], f[2], f[3]);
  };

  /* 석화한 유닛의 회색 그림: 보조 캔버스에 그 프레임을 그리고 채도를 뺀 뒤 조금 밝힌다.
     전에는 ctx.filter(grayscale)를 썼는데 아이폰(사파리·크롬 모두 WebKit)은 캔버스 filter 를 지원하지 않아 석화해도 그림이 그대로였다 (2026-11-13 사용자 제보) → 합성 모드로 직접 만든다 */
  P._stoneSprite = function (img, f) {
    var cv = this._stoneCv || (this._stoneCv = document.createElement('canvas')), w = f[2], h = f[3];
    if (cv.width < w) cv.width = w; if (cv.height < h) cv.height = h;
    var c = cv.getContext('2d'); c.globalCompositeOperation = 'source-over'; c.clearRect(0, 0, cv.width, cv.height);
    c.drawImage(img, f[0], f[1], w, h, 0, 0, w, h);
    c.globalCompositeOperation = 'saturation'; c.fillStyle = '#808080'; c.fillRect(0, 0, w, h);        // 채도 0 (밝기는 그대로)
    c.globalCompositeOperation = 'source-over'; c.fillStyle = 'rgba(214,222,230,.34)'; c.fillRect(0, 0, w, h);   // 돌 빛으로 조금 밝고 푸르게
    c.globalCompositeOperation = 'destination-in'; c.drawImage(img, f[0], f[1], w, h, 0, 0, w, h);      // 원래 모양만 남긴다
    c.globalCompositeOperation = 'source-over';
    return cv;
  };

  /* 유닛 한 기: 그림자 → 강화 이펙트 → 원본 스프라이트(Unit.frameIndex가 고른 프레임) → 체력 바 → 스킬 칸 번호 */
  P._drawUnit = function (u) {
    var ctx = this.ctx, fi = u.frameIndex(this.rules.tps), f = fi >= 0 ? u.t.frames[fi] : null, x = Math.round(u.x), y = Math.round(u.y), drop = u.drop || 0, T = this.time;
    if (!f) return;
    ctx.globalAlpha = u.state === 'dead' ? 1 - u.fade : 1;
    // 그림자: 크기는 유닛 폭(체력 바 폭)에 맞춘다
    var HB0 = root.MW && root.MW.hpbar, sw = HB0 && HB0.units[u.t.id] ? Math.max(11, Math.min(26, HB0.units[u.t.id][1] * 0.5)) : 13;
    ctx.fillStyle = 'rgba(0,0,0,.32)'; ctx.beginPath(); ctx.ellipse(x, y + 2, sw, sw * 0.4, 0, 0, 6.3); ctx.fill();   // 2026-11-13: 진영색을 빼고 그냥 그림자로 (사용자 요청). 편은 체력 바 색(아군 초록, 적 빨강)과 바라보는 방향으로 구분된다
    // 고른 유닛: 원작 선택 원(choice.spr)의 한 단계 큰 노란 원이 1.2Hz로 맥박친다 — 뒤쪽 반은 유닛보다 먼저, 앞쪽 반은 유닛 위에 (회수 버튼은 _drawSelectionOverlay)
    if (u.state !== 'dead') { if (u === this.sel) { ctx.globalAlpha = 0.775 + 0.225 * Math.sin(T * 7.54); this._ring(u, x, y + 2, 28, 0, 1); ctx.globalAlpha = 1; } }
    // 공격 강화(웨폰): 발밑에서 도는 원본 이펙트. 방어 강화(베리어)는 몸 가운데 높이 — 전장 시뮬(worldview.js)과 같은 방식
    var wb = u.buffs.weapon, sb = u.buffs.shield;
    if (wb && wb.until > T) this._loopFx(wb.arm, x, y);
    ctx.save(); ctx.translate(x, y + drop); if (u.mir) ctx.scale(-1, 1);
    if (u.stunUntil > T) ctx.drawImage(this._stoneSprite(this.assets.get(f[6] || ('u' + u.t.id)), f), 0, 0, f[2], f[3], -f[4], -f[5], f[2], f[3]);   // 석화: 돌처럼 회색 (원본은 회색 팔레트 20번, 분석 8-36)
    else ctx.drawImage(this.assets.get(f[6] || ('u' + u.t.id)), f[0], f[1], f[2], f[3], -f[4], -f[5], f[2], f[3]);
    ctx.restore();
    if (u.state !== 'dead') { if (u === this.sel) { ctx.globalAlpha = 0.775 + 0.225 * Math.sin(T * 7.54); this._ring(u, x, y + 2, 28, 1, 1); ctx.globalAlpha = 1; } }   // 원의 앞쪽 반 (발을 덮는다) ctx.globalAlpha = 1;
    if (sb && sb.until > T) { var sd = this.data.fx.arms[sb.arm], si = sd ? MWE.shieldFrame(sd, sb, u.t, T) : -1;   // 파운틴 베리어: 시전 동작은 한 번, 그 뒤 물줄기 유지 (render/assets.js)
      if (si >= 0) this._fxFrame(si, x, y - (sb.arm === 7 || sb.arm === 43 ? u.headY : u.headY >> 1), !sd.dir); }
    var hb = u.buffs.haste; if (hb && hb.until > T && u.state !== 'dead') this._loopFx(44, x, y - u.headY);   // 가속: 머리 위 (원본 FUN_004f7490과 같은 자리)
    if (u.state === 'dead') return;
    var top = y - u.headY - 8;
    var st = this._statusOf(u);
    if (u.hero) this._drawHeroPlate(u, x, y); else if (u.hp < u.maxHp || u === this.sel || st.length) this._drawHpBar(u, x, y);   // 상태 이상이 걸리면 체력이 가득해도 바를 보인다
    if (st.length) this._drawStatus(st, x, y - u.headY - (u.hero ? 22 : 9));   // 영웅은 늘 바와 별을 단다   // 원작 체력 바 (닳았을 때와 고른 유닛)
  };

  /* 조준 표시 (전장 클립 안, 화면 좌표): 준비된 시전자들의 발밑 링, 아무도 닿지 않는 곳을 옅게 어둡게, 손가락·마우스 자리에 효과 반경 원, 위쪽에 안내 한 줄 */
  P._drawAim = function () {
    if (this.screen === 'play') { var cx0 = this.ctx, cam = this.cam.x, TT = this.time;   // 마법을 쓰러 걸어가는 유닛: 찍어 둔 곳에 작은 점선 원
      this.units.forEach(function (q) { var o = q.castOrder; if (!o || q.state === 'dead') return; cx0.save(); cx0.setLineDash([4, 4]); cx0.lineDashOffset = -TT * 20; cx0.strokeStyle = 'rgba(127,214,255,.8)'; cx0.lineWidth = 1.5; cx0.beginPath(); cx0.ellipse(o.x - cam, o.y, 22, 11, 0, 0, 6.3); cx0.stroke(); cx0.restore(); }); }
    var A = this.aim; if (!A || this.screen !== 'play') return;
    var ctx = this.ctx, g = A.group, W = this.W, fh = this.H - this.hudH, T = this.time, self = this, R = this._readyOf(g), s0 = g.slots[0]; if (!s0) return;
    var r = this.aimRadius(s0), iv = [[-1e9, this.aimLimit(g) - this.cam.x]], x = 0, i;   // 찍을 수 있는 곳: 전장 가운데에서 시전 거리까지 (그 너머 적 진영 안쪽만 어둡게)
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, fh); ctx.clip();
    ctx.fillStyle = 'rgba(5,7,12,.38)';                                             // 닿지 않는 곳(시전 범위들의 바깥)을 어둡게
    for (i = 0; i < iv.length; i++) { if (iv[i][0] > x) ctx.fillRect(x, 0, Math.min(W, iv[i][0]) - x, fh); x = Math.max(x, iv[i][1]); if (x >= W) break; }
    if (x < W) ctx.fillRect(x, 0, W - x, fh);
    ctx.strokeStyle = '#7fd6ff'; ctx.lineWidth = 3; ctx.globalAlpha = 0.775 + 0.225 * Math.sin(T * 7.54);
    R.forEach(function (s) { ctx.beginPath(); ctx.ellipse(s.unit.x - self.cam.x, s.unit.y + 2, 19, 9, 0, 0, 6.3); ctx.stroke(); }); ctx.globalAlpha = 1;
    var p = this.aimPt; if (p && p.y < fh) { var okp = iv.some(function (q) { return p.x >= q[0] && p.x <= q[1]; });
      ctx.fillStyle = okp ? 'rgba(255,211,110,.16)' : 'rgba(224,88,74,.14)'; ctx.strokeStyle = okp ? '#ffd36e' : '#e0584a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 6.3); ctx.fill(); ctx.stroke(); }
    var msg = g.act.name + (g.kind === 'buff' ? ' — 걸어 줄 아군을 누르세요 (칸을 다시 누르면 취소)' : ' — 쓸 곳을 누르세요 (칸을 다시 누르면 취소)'); ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    var mw = Math.min(W - 16, ctx.measureText(msg).width + 20), my = Math.max(this.topBox.y + this._topH(), this.miniBox.y + this.miniBox.h) + 8;
    ctx.fillStyle = 'rgba(8,10,16,.8)'; ctx.fillRect(W / 2 - mw / 2, my, mw, 24); ctx.fillStyle = '#7fd6ff'; ctx.fillText(this._fit(msg, mw - 10), W / 2, my + 12.5);
    ctx.textAlign = 'left'; ctx.restore();
  };

  /* 웨이브 알림: 위쪽 표시 바로 아래에 "웨이브 N"이 잠깐 떴다가 사라진다. 전투를 가리지 않게 작고 짧게 —
     어두운 바탕 없이 글자 테두리만, 유닛이 서는 줄(전투 줄)보다 위에만 그린다. 새로 나오는 적이 있으면 그 아래 한 줄에 작은 그림과 이름.
     누르는 것을 막지 않는다(그림일 뿐). 2.2초, 새 적이 있으면 3초 */
  P._drawBanner = function () {
    var b = this.banner; if (!b || this.screen !== 'play' || this.aim || this.selBase) return;   // 조준 안내와 같은 자리라 조준 중에는 그리지 않는다
    var F = b.fresh, total = F.length ? 3 : 2.2, t = this.time - b.t0; if (t < 0) return; if (t > total) { this.banner = null; return; }
    var al = Math.max(0, Math.min(1, t / 0.25, (total - t) / 0.5)), ctx = this.ctx, W = this.W, fh = this.H - this.hudH, n = CONFIG.WAVES.length, last = b.wave === n - 1;
    var top = Math.max(this.topBox.y + this._topH(), this.miniBox.y + this.miniBox.h) + 28, k = 1 + 0.2 * Math.max(0, 1 - t / 0.25);
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, fh); ctx.clip(); ctx.globalAlpha = al;
    // 알림이 떠 있는 동안 위쪽 띠만 어둡게 (2026-11-13: 글자가 잘 안 보인다는 지적). 아래로 갈수록 옅어져 전투 줄에는 닿지 않는다
    var bandH = top + (F.length ? 86 : 44), dg = ctx.createLinearGradient(0, 0, 0, bandH); dg.addColorStop(0, 'rgba(4,6,10,.78)'); dg.addColorStop(0.62, 'rgba(4,6,10,.62)'); dg.addColorStop(1, 'rgba(4,6,10,0)');
    ctx.fillStyle = dg; ctx.fillRect(0, 0, W, bandH);
    ctx.globalAlpha = al * 0.97;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round'; ctx.strokeStyle = 'rgba(0,0,0,.9)';
    ctx.save(); ctx.translate(W / 2, top); ctx.scale(k, k);
    var title = (last ? '마지막 웨이브' : '웨이브 ' + (b.wave + 1)); ctx.font = 'bold 34px sans-serif'; ctx.lineWidth = 6;
    ctx.strokeText(title, 0, 0); ctx.fillStyle = last ? '#ff8a7a' : '#ffd36e'; ctx.fillText(title, 0, 0);
    var tw2 = ctx.measureText(title).width / 2 + 12; ctx.fillStyle = last ? 'rgba(255,138,122,.8)' : 'rgba(255,211,110,.8)'; ctx.fillRect(-tw2 - 46, -1, 46, 2); ctx.fillRect(tw2, -1, 46, 2);   // 양옆 가는 선
    ctx.restore();
    if (F.length) { var figs = this.assets.get('figs'), cw = Math.min(64, Math.floor((W - 16) / F.length)), y = top + 28, i;
      for (i = 0; i < F.length; i++) { var x = W / 2 + (i - (F.length - 1) / 2) * cw, ty = F[i], magic = (CONFIG.ENEMY_SKILL.on || b.wave + 1 >= CONFIG.ENEMY_SKILL.fromWave) && skillsOf(ty).some(function (a) { return skillKind(a) !== 'morph'; });
        ctx.drawImage(figs, ty.pid * 36, 0, 36, 43, Math.round(x - 11), y, 22, 26);
        ctx.font = 'bold 10px sans-serif'; ctx.lineWidth = 3; var nm = this._fit(ty.name, cw - 2); ctx.strokeText(nm, x, y + 33); ctx.fillStyle = magic ? '#ff8a7a' : '#dfe6f5'; ctx.fillText(nm, x, y + 33); } }   // 마법을 쓰는 적은 이름이 붉다
    ctx.textAlign = 'left'; ctx.restore();
  };

  /* 원작 HUD 풍 판: 모서리를 깎은 어두운 판 + 청동 테두리(위는 밝고 아래는 어둡게) + 안쪽 가는 선 + 네 귀의 징. 회수 팻말과 같은 생김새 */
  /* 창·카드의 판. HUD 스킨 2단계(2026-11-13): 원작 대화창(dialogLiber.spr → hudwin.png, tools/hudwinbuild.js)을 아홉 조각으로 잘라 입힌다 —
     모서리는 그대로, 변과 가운데는 늘린다. skin: 'dark' = 유닛 정보 창의 검은 돌판(설명 카드), 그 밖 = 청동 테 양피지(카드·모달·버튼).
     양피지 바탕은 밝아서 흰 글자가 안 읽히므로 어둡게 덮는다(dim). hot = 강조(영웅 카드, 고른 버튼): 덜 어둡게 + 금빛 테. 그림이 아직 없으면 예전 그림(아래)으로 */
  var WIN = { bronze: { r: [0, 0, 414, 218], cs: 34, pad: 9, dim: 0.66, hot: 0.42 }, dark: { r: [0, 220, 347, 179], cs: 8, pad: 4, dim: 0, hot: 0 } };
  P._plateSkin = function (x, y, w, h, hot, skin) {
    var im = this.assets.get('hudwin'); if (!im || !im.naturalWidth) return false;
    var K = WIN[skin] || WIN.bronze, r = K.r, ctx = this.ctx, cs = Math.max(4, Math.min(K.cs, Math.floor(w * 0.3), Math.floor(h * 0.42))), k = cs / K.cs, sc = K.cs;
    x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
    ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(x + 3, y + 4, w, h);
    var sx = [r[0], r[0] + sc, r[0] + r[2] - sc], sw = [sc, r[2] - 2 * sc, sc], sy = [r[1], r[1] + sc, r[1] + r[3] - sc], sh = [sc, r[3] - 2 * sc, sc];
    var dx = [x, x + cs, x + w - cs], dw = [cs, w - 2 * cs, cs], dy = [y, y + cs, y + h - cs], dh = [cs, h - 2 * cs, cs];
    for (var j = 0; j < 3; j++) for (var i = 0; i < 3; i++) if (dw[i] > 0 && dh[j] > 0) ctx.drawImage(im, sx[i], sy[j], sw[i], sh[j], dx[i], dy[j], dw[i], dh[j]);
    var p = Math.max(2, Math.round(K.pad * k)), d = hot ? K.hot : K.dim;
    if (d > 0) { ctx.fillStyle = 'rgba(10,7,4,' + d + ')'; ctx.fillRect(x + p, y + p, w - 2 * p, h - 2 * p); }
    if (hot) { ctx.strokeStyle = 'rgba(255,224,140,.85)'; ctx.lineWidth = 1; ctx.strokeRect(x + p + 0.5, y + p + 0.5, w - 2 * p - 1, h - 2 * p - 1); }
    return true;
  };
  P._plate = function (x, y, w, h, c, hot, skin) {
    if (this._plateSkin(x, y, w, h, hot, skin)) return;
    var ctx = this.ctx, path = function (px, py, pw, ph, k) { ctx.beginPath(); ctx.moveTo(px + k, py); ctx.lineTo(px + pw - k, py); ctx.lineTo(px + pw, py + k); ctx.lineTo(px + pw, py + ph - k); ctx.lineTo(px + pw - k, py + ph); ctx.lineTo(px + k, py + ph); ctx.lineTo(px, py + ph - k); ctx.lineTo(px, py + k); ctx.closePath(); };
    ctx.fillStyle = 'rgba(0,0,0,.5)'; path(x + 3, y + 4, w, h, c); ctx.fill();
    var gb = ctx.createLinearGradient(0, y, 0, y + h); gb.addColorStop(0, hot ? '#fff0b8' : '#e6c476'); gb.addColorStop(0.45, '#a8823a'); gb.addColorStop(1, '#5c431a');
    ctx.fillStyle = gb; path(x, y, w, h, c); ctx.fill();
    var gi = ctx.createLinearGradient(0, y, 0, y + h); gi.addColorStop(0, '#262b3a'); gi.addColorStop(1, '#0c0e15');
    ctx.fillStyle = gi; path(x + 3, y + 3, w - 6, h - 6, c - 1); ctx.fill();
    ctx.strokeStyle = 'rgba(255,233,176,.22)'; ctx.lineWidth = 1; path(x + 5.5, y + 5.5, w - 11, h - 11, c - 2); ctx.stroke();
    ctx.fillStyle = '#f3dc9a'; [[x + 7, y + 7], [x + w - 9, y + 7], [x + 7, y + h - 9], [x + w - 9, y + h - 9]].forEach(function (q) { ctx.fillRect(q[0], q[1], 2, 2); });
  };
  /* 레벨업 카드 화면: 전장을 어둡게 덮고(게임은 멈춰 있다) 가운데에 카드 3장.
     카드 = 판 + 그림(영웅은 원작 초상화, 나머지는 원작 아이콘·작은 그림·성 그림) + 이름 + 설명 + 변화 값 */
  P._drawCards = function () {
    var ctx = this.ctx, W = this.W, H = this.H, C = this.cards, self = this, al = Math.min(1, this.cardT / 0.25), D = this.data.fx.icon, icons = this.assets.get('acticons'), figs = this.assets.get('figs'), por = this.assets.get('portraits');
    ctx.save(); ctx.globalAlpha = al; ctx.fillStyle = 'rgba(5,7,12,.74)'; ctx.fillRect(0, 0, W, H);
    var top = C[0].box.y; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    ctx.font = 'bold 26px sans-serif'; ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,.9)'; ctx.strokeText('레벨 업!', W / 2, top - 52); ctx.fillStyle = '#ffd36e'; ctx.fillText('레벨 업!', W / 2, top - 52);
    ctx.font = 'bold 12px sans-serif'; ctx.fillStyle = '#c9d1e3'; ctx.fillText('Lv ' + (this.plv - this.pendingLv + 1) + ' — 하나를 고르세요', W / 2, top - 26);
    var icoOf = function (name) { var ic = -1; self.data.units.forEach(function (d) { (d.acts || []).forEach(function (a) { if (a && a.name === name && ic < 0) ic = a.icon; }); }); return ic; };
    C.forEach(function (c) {
      var b = c.box, cx = b.x + b.w / 2, ay = b.y + 12, aw = b.w - 24, ah = 78;
      self._plate(b.x, b.y, b.w, b.h, 7, c.kind === 'hero');
      ctx.fillStyle = '#080a10'; ctx.fillRect(b.x + 12, ay, aw, ah); ctx.strokeStyle = '#5c431a'; ctx.lineWidth = 1; ctx.strokeRect(b.x + 12.5, ay + 0.5, aw - 1, ah - 1);
      ctx.save(); ctx.beginPath(); ctx.rect(b.x + 13, ay + 1, aw - 2, ah - 2); ctx.clip();
      if (c.kind === 'hero' && por && por.naturalWidth) { var id = c.unit.pid, pw = aw - 2, ph = Math.round(pw * 160 / 120); ctx.drawImage(por, (id % 12) * 120, Math.floor(id / 12) * 160, 120, 160, b.x + 13, ay + 1 - Math.round((ph - ah) * 0.18), pw, ph); }
      else if (c.kind === 'lv') { [0, 1, 4].forEach(function (pid, k) { ctx.drawImage(figs, pid * 36, 0, 36, 43, Math.round(cx - 46 + k * 30), ay + 18, 34, 41); }); }
      else if (c.kind === 'repair') { var bp = self.bld.pics && self.bld.base ? self.bld.pics[self.bld.base.pic] : null; if (bp) { var k2 = Math.min((aw - 6) / bp[2], (ah - 6) / bp[3]); ctx.drawImage(self.assets.get('defense'), bp[0], bp[1], bp[2], bp[3], Math.round(cx - bp[2] * k2 / 2), Math.round(ay + ah / 2 - bp[3] * k2 / 2), Math.round(bp[2] * k2), Math.round(bp[3] * k2)); } }
      else { var ic = icoOf(c.kind === 'mana' ? '말다 소환' : c.kind === 'magic' ? '라이트닝 썬더' : '나르 소환'), fi = ic * 2 + 1, s2 = 1.5; if (ic >= 0) ctx.drawImage(icons, (fi % D.cols) * D.w, Math.floor(fi / D.cols) * D.h, D.w, D.h, Math.round(cx - D.w * s2 / 2), Math.round(ay + ah / 2 - D.h * s2 / 2), Math.round(D.w * s2), Math.round(D.h * s2)); }
      ctx.restore();
      if (c.kind === 'hero') { var HB = root.MW && root.MW.hpbar, st = HB && HB.frames[7]; if (st) ctx.drawImage(self.assets.get('hpbar'), st[0], st[1], st[2], st[3], b.x + 15, ay + 3, st[2], st[3]); }   // 영웅 별
      ctx.textAlign = 'center'; ctx.font = 'bold 13px sans-serif'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.9)'; var nm = self._fit(c.name, b.w - 12); ctx.strokeText(nm, cx, ay + ah + 16); ctx.fillStyle = '#ffe9b0'; ctx.fillText(nm, cx, ay + ah + 16);
      ctx.font = '10px sans-serif'; ctx.fillStyle = '#c9d1e3'; var lines = self._wrapAny(c.desc, b.w - 18).slice(0, 5); lines.forEach(function (ln, k) { ctx.fillText(ln, cx, ay + ah + 36 + k * 13); });
      ctx.font = 'bold 10px sans-serif'; ctx.fillStyle = '#8fc7ff'; ctx.fillText(self._fit(c.tag, b.w - 14), cx, b.y + b.h - 16);
    });
    ctx.textAlign = 'left'; ctx.restore();
  };
  /* 글을 폭 w 안에 들어가게 나눈다 — 띄어쓰기에서 나누되, 한 낱말이 너무 길면 글자 단위로도 나눈다 (좁은 카드용) */
  P._wrapAny = function (str, w) {
    var ctx = this.ctx, out = [], line = '';
    str.split(' ').forEach(function (wd) { var t = line ? line + ' ' + wd : wd;
      if (ctx.measureText(t).width <= w) { line = t; return; }
      if (line) { out.push(line); line = ''; }
      while (ctx.measureText(wd).width > w && wd.length > 1) { var k = wd.length - 1; while (k > 1 && ctx.measureText(wd.slice(0, k)).width > w) k--; out.push(wd.slice(0, k)); wd = wd.slice(k); }
      line = wd; });
    if (line) out.push(line); return out;
  };

  /* 성을 골랐을 때: 위쪽 안내 한 줄 (성의 초록 윤곽선은 _drawOutline) ("성 선택 — 소환하면 성에 배치"). 성이 화면 밖이어도 안내는 남아 지금 상태를 알려 준다 */
  P._drawBaseSel = function () {
    if (!this.selBase || this.screen !== 'play') return;
    var ctx = this.ctx, bb = this._baseBox(), W = this.W, fh = this.H - this.hudH, full = this.garrison.length >= this.garCap(); if (!bb) return;
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, fh); ctx.clip();
    var nm = this._fort().name, msg = full ? nm + ' 선택 — 가득 참 (' + this.garrison.length + '/' + this.garCap() + ')' + (this.garDef() ? ' · 방어 +' + this.garDef() : '') + ' · 다른 곳을 누르면 해제' : nm + ' 선택 — 소환하면 ' + nm + '에 배치 (' + this.garrison.length + '/' + this.garCap() + ') · 다른 곳을 누르면 해제';
    ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    var mw = Math.min(W - 16, ctx.measureText(msg).width + 20), my = Math.max(this.topBox.y + this._topH(), this.miniBox.y + this.miniBox.h) + 8;
    ctx.fillStyle = 'rgba(8,10,16,.8)'; ctx.fillRect(W / 2 - mw / 2, my, mw, 24); ctx.fillStyle = '#ffd36e'; ctx.fillText(this._fit(msg, mw - 10), W / 2, my + 12.5);
    ctx.textAlign = 'left'; ctx.restore();
  };
  /* 고른 유닛 머리 위의 [회수 +N] 버튼. 전장 클립 안, 화면 좌표. 유닛이 화면 밖이면 그리지 않는다 */
  P._drawSelectionOverlay = function () {
    if (this.screen !== 'play') return;
    var u = this.sel, base = !u && this.selBase && this.garrison.length ? this._retreatBox() : null;   // 성을 골랐으면 같은 팻말에 "퇴각"
    if (!base && (!u || !this._recallable(u))) return;
    var sx = base ? base.tx : u.x - this.cam.x; if (sx < -30 || sx > this.W + 30) return;
    var ctx = this.ctx, b = base || this._recallBtnBox(u), c = 5, tx = Math.max(b.x + 12, Math.min(b.x + b.w - 12, Math.round(sx)));
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, this.W, this.H - this.hudH); ctx.clip();
    // 팻말: 원작 HUD 의 명령 칸처럼 — 모서리를 깎은 어두운 판, 청동 테두리(위는 밝고 아래는 어둡게), 안쪽 가는 선, 네 귀의 징
    var plate = function (x, y, w, h, k) { ctx.beginPath(); ctx.moveTo(x + k, y); ctx.lineTo(x + w - k, y); ctx.lineTo(x + w, y + k); ctx.lineTo(x + w, y + h - k); ctx.lineTo(x + w - k, y + h); ctx.lineTo(x + k, y + h); ctx.lineTo(x, y + h - k); ctx.lineTo(x, y + k); ctx.closePath(); };
    ctx.fillStyle = 'rgba(0,0,0,.45)'; plate(b.x + 2, b.y + 3, b.w, b.h, c); ctx.fill();                       // 그림자
    ctx.beginPath(); ctx.moveTo(tx - 7, b.y + b.h - 1); ctx.lineTo(tx + 7, b.y + b.h - 1); ctx.lineTo(tx, b.y + b.h + 7); ctx.closePath(); ctx.fillStyle = '#6b4f1e'; ctx.fill();   // 유닛을 가리키는 쐐기 (테두리 색)
    var gb = ctx.createLinearGradient(0, b.y, 0, b.y + b.h); gb.addColorStop(0, '#e6c476'); gb.addColorStop(0.45, '#a8823a'); gb.addColorStop(1, '#5c431a');
    ctx.fillStyle = gb; plate(b.x, b.y, b.w, b.h, c); ctx.fill();                                                 // 청동 테두리
    var gi = ctx.createLinearGradient(0, b.y, 0, b.y + b.h); gi.addColorStop(0, '#262b3a'); gi.addColorStop(1, '#0c0e15');
    ctx.fillStyle = gi; plate(b.x + 2, b.y + 2, b.w - 4, b.h - 4, c - 1); ctx.fill();                             // 어두운 판
    ctx.strokeStyle = 'rgba(255,233,176,.22)'; ctx.lineWidth = 1; plate(b.x + 3.5, b.y + 3.5, b.w - 7, b.h - 7, c - 2); ctx.stroke();   // 안쪽 가는 선
    ctx.beginPath(); ctx.moveTo(tx - 4, b.y + b.h - 2); ctx.lineTo(tx + 4, b.y + b.h - 2); ctx.lineTo(tx, b.y + b.h + 3); ctx.closePath(); ctx.fillStyle = '#0c0e15'; ctx.fill();   // 쐐기 속
    ctx.fillStyle = '#f3dc9a'; [[b.x + 5, b.y + 5], [b.x + b.w - 7, b.y + 5], [b.x + 5, b.y + b.h - 7], [b.x + b.w - 7, b.y + b.h - 7]].forEach(function (q) { ctx.fillRect(q[0], q[1], 2, 2); });   // 징
    // 내용: 왼쪽에 원작 리콜(넨 소환) 아이콘, 오른쪽에 "회수"와 돌려받는 마나
    if (b.small) { ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.9)'; ctx.font = 'bold 12px sans-serif'; var st0 = '퇴각 ' + this.garrison.length + '기';   // 건물의 [퇴각]: 한 줄짜리 작은 팻말
      ctx.strokeText(st0, b.x + b.w / 2, b.y + b.h / 2 + 0.5); ctx.fillStyle = '#ffe9b0'; ctx.fillText(st0, b.x + b.w / 2, b.y + b.h / 2 + 0.5); ctx.textAlign = 'left'; ctx.restore(); return; }
    var D = this.data.fx.icon, ic = this.recallIcon, ih = b.h - 12, iw = Math.round(ih * D.w / D.h), ix = b.x + 7, cx = ix + iw + (b.x + b.w - 6 - ix - iw) / 2;
    if (ic >= 0) { var fi = ic * 2; ctx.drawImage(this.assets.get('acticons'), (fi % D.cols) * D.w, Math.floor(fi / D.cols) * D.h, D.w, D.h, ix, b.y + 6, iw, ih); } else cx = b.x + b.w / 2;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.9)';
    var word = base ? '퇴각' : '회수';
    ctx.font = 'bold 12px sans-serif'; ctx.strokeText(word, cx, b.y + 15); ctx.fillStyle = '#ffe9b0'; ctx.fillText(word, cx, b.y + 15);
    var rf = base ? this.garrison.length + '기' : '+' + this._refundOf(u); ctx.font = 'bold 12px sans-serif'; ctx.strokeText(rf, cx, b.y + 30); ctx.fillStyle = '#8fc7ff'; ctx.fillText(rf, cx, b.y + 30);   // 마나 색 (소환 버튼의 마나 값과 같은 색)
    ctx.textAlign = 'left'; ctx.restore();
  };

  /* 원작 체력 바 — 전장 시뮬(render/worldview.js)과 같은 그림·색·폭·채움 식 (FUN_004f7cf0, 분석 8-27):
       bar.spr 틀(종류별 폭 unitData +0x100), 초록이고 폭의 1/3 이하면 빨강, 오른쪽에 레벨 숫자(helpnum.mwl).
       적은 늘 빨강(목업 고유, 피아 구분). 자리는 머리 위(원본은 발밑·선택한 유닛만). 이 게임은 유닛 마나가 없어 마나 줄은 없다 */
  P._drawHpBar = function (u, x, y) {
    var HB = root.MW && root.MW.hpbar, him = this.assets.get('hpbar'), ctx = this.ctx; if (!HB || !him) return;
    var hb = HB.units[u.t.id] || HB.units[0], bw = hb[1], hf = HB.frames[hb[0]], x0 = x - (bw >> 1), hy = y - u.headY - 6, fill = Math.floor(Math.max(0, u.hp) * bw / u.maxHp);
    ctx.fillStyle = u.side !== 0 || fill <= Math.floor(bw / 3) ? HB.low : HB.hp; ctx.fillRect(x0, hy, fill + 1, 3);
    ctx.drawImage(him, hf[0], hf[1], hf[2], hf[3], x - hf[4], hy - 11 - hf[5], hf[2], hf[3]);
    for (var ls = String(u.level), li = 0, lx = x0 + bw + 3; li < ls.length; li++, lx += 5) { var lg = HB.digits[ls.charCodeAt(li) - 48]; if (lg) ctx.drawImage(him, lg[0], lg[1], lg[2], lg[3], lx - lg[4], hy - 3 - lg[5], lg[2], lg[3]); }
    if (u.hero) { var st = HB.frames[7]; ctx.drawImage(him, st[0], st[1], st[2], st[3], x0 - st[4] - 2, hy - 18 - st[5], st[2], st[3]); }   // 원작의 영웅 별 (bar.spr 7번 — 원작 데이터에는 켜진 유닛이 없다)
  };

  /* 상태 이상 표시 (2026-11-12 사용자 요청): 체력 바 바로 위에 원작 상태 아이콘(unitState.spr, 18×18)을 한 줄로. 여러 개가 겹치면 옆으로 나란히, 가운데 정렬.
     STATUS_ICON = 상태 → unitState.spr 프레임. 그림 뜻으로 맞춘 것(원본 코드의 대응표는 아직 해독하지 않음): 12 부러진 칼 = 멜팅 웨폰, 13 깨진 갑옷 = 멜팅 아머, 14 하트 = 매혹, 5 붙잡는 손 = 멈춤(석화) */
  var STATUS_ICON = { meltw: 12, melta: 13, charm: 14, stun: 5, poison: 6 };   // 6 해골 병 = 중독
  P._statusOf = function (u) {
    var T = this.time, b = u.buffs, L = [];
    if (u.stunUntil > T) L.push(STATUS_ICON.stun);
    if (b.meltw && b.meltw.until > T) L.push(STATUS_ICON.meltw);
    if (b.melta && b.melta.until > T) L.push(STATUS_ICON.melta);
    if (b.poison && b.poison.until > T) L.push(STATUS_ICON.poison);
    if (u.charmed) L.push(STATUS_ICON.charm);
    return L;
  };
  P._drawStatus = function (L, x, bottom) {
    var HB = root.MW && root.MW.hpbar, him = this.assets.get('hpbar'), ctx = this.ctx; if (!HB || !HB.states || !him) return;
    var gap = 1, w = 18, x0 = Math.round(x - (L.length * w + (L.length - 1) * gap) / 2);
    for (var i = 0; i < L.length; i++) { var f = HB.states[L[i]]; if (f) ctx.drawImage(him, f[0], f[1], f[2], f[3], x0 + i * (w + gap), Math.round(bottom) - f[3], f[2], f[3]); }
  };

  /* 영웅 이름표: 원작(온라인판) 유닛 머리 위의 둥근 이름표 — 영웅은 체력 막대 대신 이름표 바탕이 체력만큼 채워진다 (2026-11-12 사용자 요청·참고 화면).
     어두운 반투명 알약 모양 위에 초록(체력 1/3 이하는 붉은) 채움, 흰 이름 + 레벨 */
  P._drawHeroPlate = function (u, x, y) {
    var ctx = this.ctx, s = u.t.name + '(' + u.level + ')'; ctx.save(); ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    var w = Math.ceil(ctx.measureText(s).width) + 12, h = 13, x0 = Math.round(x - w / 2), y0 = Math.round(y - u.headY - 6 - h), r = h / 2, k = Math.max(0, Math.min(1, u.hp / u.maxHp));
    var pill = function () { ctx.beginPath(); ctx.moveTo(x0 + r, y0); ctx.lineTo(x0 + w - r, y0); ctx.arc(x0 + w - r, y0 + r, r, -Math.PI / 2, Math.PI / 2); ctx.lineTo(x0 + r, y0 + h); ctx.arc(x0 + r, y0 + r, r, Math.PI / 2, Math.PI * 1.5); ctx.closePath(); };
    pill(); ctx.fillStyle = 'rgba(14,18,24,.72)'; ctx.fill();
    ctx.save(); pill(); ctx.clip(); ctx.fillStyle = k <= 1 / 3 ? 'rgba(200,62,48,.85)' : 'rgba(58,150,84,.85)'; ctx.fillRect(x0, y0, Math.round(w * k), h); ctx.restore();
    pill(); ctx.strokeStyle = 'rgba(210,225,215,.55)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.fillText(s, x, y0 + r + 0.5); ctx.restore();
  };

  /* 계속 도는 이펙트 한 장 (유닛에 붙은 강화 표시) */
  P._loopFx = function (arm, x, y) {
    var d = this.data.fx.arms[arm], fr = d && (d.fly.length ? d.fly : d.hit); if (!fr || !fr.length) return;
    this._fxFrame(fr[Math.floor(this.time * 15) % fr.length], x, y, !d.dir);
  };

  /* 발사체: 방향 없는 이펙트(불덩이 등)는 원본 그림, 방향 있는 것(화살)은 선으로 */
  P._drawShot = function (s) {
    var ctx = this.ctx, fl = s.def.fly;
    if (!s.def.dir && fl.length) this._fxFrame(fl[Math.floor((this.time - s.t0) * 15) % fl.length], s.x, s.y, true);
    else { var a = s.ang || (s.dir > 0 ? 0 : Math.PI); ctx.strokeStyle = '#f3e3b0'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(s.x - Math.cos(a) * 9, s.y - Math.sin(a) * 9); ctx.lineTo(s.x + Math.cos(a) * 9, s.y + Math.sin(a) * 9); ctx.stroke(); }
  };

  P._drawEffect = function (e) {
    var k = Math.floor((this.time - e.t0) * 15); if (k < 0 || k >= e.f.length) return;
    this._fxFrame(e.f[k], e.x, e.y, e.add);
  };

  /* 이펙트 시트 n번(armsN.png)을 받는다 (한 번만) */
  P._loadFxSheet = function (n) { if (this.fxSheets[n]) return; this.fxSheets[n] = 1; this.assets.load('arms' + n, 'arms' + n + '.png'); };
  /* 이펙트 그림 한 장 (프레임 번호 → 시트 armsN.png 안의 자리). add = 빛나는 가산 합성. 그 시트를 아직 안 받았으면 받기 시작하고 이번에는 건너뛴다 */
  P._fxFrame = function (idx, x, y, add) {
    var fr = this.data.fx.frames[idx], ctx = this.ctx; if (!fr) return;
    var n = fr[6] || 0, im = this.assets.get('arms' + n); if (!im) { this._loadFxSheet(n); return; } if (!im.naturalWidth) return;
    if (add) ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(im, fr[0], fr[1], fr[2], fr[3], Math.round(x - fr[4]), Math.round(y - fr[5]), fr[2], fr[3]);
    if (add) ctx.globalCompositeOperation = 'source-over';
  };

  P._drawTexts = function () {
    var ctx = this.ctx; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (var i = 0; i < this.texts.length; i++) { var t = this.texts[i], k = (this.time - t.t0) / 0.8;
      ctx.globalAlpha = 1 - k; ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.strokeText(t.s, t.x, t.y - k * 22); ctx.fillStyle = t.col; ctx.fillText(t.s, t.x, t.y - k * 22); }
    ctx.globalAlpha = 1; ctx.textAlign = 'left';
  };

  P._bar = function (x, y, w, h, ratio, col) {
    var ctx = this.ctx; ctx.fillStyle = 'rgba(0,0,0,.7)'; ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    ctx.fillStyle = col; ctx.fillRect(x, y, Math.round(w * Math.max(0, Math.min(1, ratio))), h);
  };

  /* HUD: 위 = 기지 체력·마나·수비 / 웨이브 / 진행 막대 / 소리, 아래 = 소환 패널 + 스킬 패널. 자리는 모두 _layout이 정한 상자 */
  P._drawHud = function () {
    var ctx = this.ctx, W = this.W, H = this.H, C = CONFIG, T = this.topBox, bx = T.x + 40, bw = T.w - 90, rx = T.x + T.w - 6;
    // 위 왼쪽: 기지 체력과 마나
    ctx.font = 'bold 12px sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(T.x, T.y, T.w, this._topH());
    ctx.fillStyle = '#dfe6f5'; ctx.fillText('기지', T.x + 8, T.y + 13);
    this._bar(bx, T.y + 7, bw, 12, this.baseHp / C.BASE.hp, this.baseHp / C.BASE.hp > 0.35 ? '#5fd46a' : '#e0584a');
    ctx.fillStyle = '#fff'; ctx.textAlign = 'right'; ctx.fillText(Math.ceil(this.baseHp), rx, T.y + 13);
    ctx.textAlign = 'left'; ctx.fillStyle = '#8fc7ff'; ctx.fillText('마나', T.x + 8, T.y + 33);
    this._bar(bx, T.y + 27, bw, 12, this.mana / this.manaMax, '#3f8fe8');
    ctx.fillStyle = '#fff'; ctx.textAlign = 'right'; ctx.fillText(Math.floor(this.mana), rx, T.y + 33);
    // 경험치: 가는 금색 줄 + 플레이어 레벨
    ctx.textAlign = 'left'; ctx.font = 'bold 10px sans-serif'; ctx.fillStyle = '#ffd36e'; ctx.fillText('Lv ' + this.plv, T.x + 8, T.y + 49);
    this._bar(bx, T.y + 46, bw, 6, this.xp / this._xpNeed(), '#e6c476'); ctx.font = 'bold 12px sans-serif';
    // 성 안의 유닛(수비대): 작은 그림을 자리 순서대로
    // 웨이브
    var wb = this.waveBox, wv = Math.min(this.wave + 1, C.WAVES.length), left = this._alive(1).length + this.queue.length;
    ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(wb.x, wb.y, wb.w, wb.h);
    ctx.fillStyle = '#ffd36e'; ctx.fillText(this._fit(this.narrow ? '웨이브 ' + wv + '/' + C.WAVES.length + ' · 적 ' + left : '웨이브 ' + wv + ' / ' + C.WAVES.length + '   남은 적 ' + left, wb.w - 6), wb.x + wb.w / 2, wb.y + wb.h / 2);
    this._drawMini();
    // 소리
    var sb = this.soundBtn; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(sb.x, sb.y, sb.w, sb.h);
    ctx.fillStyle = this.soundOn ? '#dfe6f5' : '#6f7687'; ctx.fillText(this.soundOn ? '소리' : '무음', sb.x + sb.w / 2, sb.y + sb.h / 2);
    var ab = this.affBtn; ctx.fillStyle = this.modal === 'aff' ? 'rgba(122,74,18,.9)' : 'rgba(0,0,0,.5)'; ctx.fillRect(ab.x, ab.y, ab.w, ab.h); ctx.fillStyle = '#ffd36e'; ctx.fillText('상성', ab.x + ab.w / 2, ab.y + ab.h / 2);   // 유닛 상성 모달 열기

    // 아래 바탕
    var y0 = H - this.hudH, hi = this.assets.get('hud0'), K = SKIN; ctx.fillStyle = '#12151d'; ctx.fillRect(0, y0, W, this.hudH);
    if (hi) { ctx.drawImage(hi, K.stripe[0], K.stripe[1], K.stripe[2], K.stripe[3], 0, y0, W, this.hudH);      // 원작 정보 창의 어두운 줄무늬 바탕
      ctx.drawImage(hi, K.rail[0], K.rail[1], K.rail[2], K.rail[3], 0, y0 - 1, W, K.rail[3]); }                  // 위쪽 가장자리: 원작의 은색 테
    else { ctx.fillStyle = '#2a3040'; ctx.fillRect(0, y0, W, 2); }
    this._drawSummonPanel();
    this._drawSkillPanel();
    ctx.textAlign = 'left';
  };

  /* 진행 막대: 전장 전체(성 ― 마굴)를 한 줄로 줄여 아군(파랑)·적(빨강) 위치와 지금 화면이 비추는 구간(흰 테두리)을 보여 준다. 누르면 그곳으로 */
  P._drawMini = function () {
    var ctx = this.ctx, C = CONFIG, m = this.miniBox, k = m.w / C.WORLD_W, L = this.units, cy = m.y + m.h / 2;
    ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(m.x - 4, m.y - 2, m.w + 8, m.h + 4);
    ctx.fillStyle = '#2a3040'; ctx.fillRect(m.x, cy - 1, m.w, 2);
    ctx.fillStyle = '#9fb4d8'; ctx.fillRect(m.x, m.y + 1, 6, m.h - 2);                       // 성
    ctx.fillStyle = '#a060c0'; ctx.fillRect(m.x + m.w - 6, m.y + 1, 6, m.h - 2);             // 마굴
    for (var i = 0; i < L.length; i++) { var u = L[i]; if (u.state === 'dead') continue;
      ctx.fillStyle = u.side === 0 ? '#5aaaff' : '#ff5a46'; ctx.fillRect(Math.round(m.x + u.x * k) - 1, cy + (u.side === 0 ? -4 : 1), 3, 3); }
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.strokeRect(Math.round(m.x + this.cam.x * k) + 0.5, m.y + 0.5, Math.round(this.W * k), m.h - 1);
  };

  /* 원작 HUD 스킨 (2026-11-13, 1단계: 아래 패널): 해방부대 HUD 그림(hud0.png = liber.img, 800×152)에서 부품을 잘라 지금 배치에 입힌다.
     가로 화면용 한 장이라 통째로 쓸 수 없어 조각으로 — 명령 칸(어두운 바탕 + 은색 테), 정보 창의 줄무늬 바탕, 이름표(청록 막대), 아래 은색 테.
     좌표는 hud0.png 안의 [x, y, w, h]. 그림이 아직 없으면 false 를 돌려주고 부르는 쪽이 예전 색으로 그린다 */
  var SKIN = { tex: [594, 8, 33, 38], barV: [629, 8, 4, 38], barH: [594, 48, 33, 5], corner: [629, 48, 4, 5], stripe: [150, 50, 140, 84], plate: [148, 20, 152, 18], rail: [160, 143, 120, 6] };
  /* 원작 명령 칸 하나: 안쪽은 바탕 무늬를 늘이고, 네 변은 은색 테 조각을 늘이고, 네 귀는 교차 조각 */
  P._cell = function (x, y, w, h) {
    var im = this.assets.get('hud0'), ctx = this.ctx, K = SKIN, t = 4; if (!im) return false;
    var d = function (q, dx, dy, dw, dh) { ctx.drawImage(im, q[0], q[1], q[2], q[3], dx, dy, dw, dh); };
    d(K.tex, x + t, y + t, w - t * 2, h - t * 2);
    d(K.barV, x, y + t, t, h - t * 2); d(K.barV, x + w - t, y + t, t, h - t * 2);
    d(K.barH, x + t, y, w - t * 2, t); d(K.barH, x + t, y + h - t, w - t * 2, t);
    d(K.corner, x, y, t, t); d(K.corner, x + w - t, y, t, t); d(K.corner, x, y + h - t, t, t); d(K.corner, x + w - t, y + h - t, t, t);
    return true;
  };
  /* 원작 이름표(청록 막대): 양 끝 8px 은 그대로, 가운데만 늘인다 */
  P._plateBar = function (x, y, w, h, alpha) {
    var im = this.assets.get('hud0'), ctx = this.ctx, q = SKIN.plate, e = 8; if (!im) return false;
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    ctx.drawImage(im, q[0], q[1], e, q[3], x, y, e, h); ctx.drawImage(im, q[0] + q[2] - e, q[1], e, q[3], x + w - e, y, e, h);
    ctx.drawImage(im, q[0] + e, q[1], q[2] - e * 2, q[3], x + e, y, w - e * 2, h);
    ctx.globalAlpha = 1; return true;
  };

  /* 소환 패널: 탭 + [성 배치] 토글 + 지금 탭의 유닛 버튼. 버튼 = 원본 유닛 작은 그림(figs.png, 유닛 번호 × 36px) + 이름 + 마나 값.
     버튼 안의 그림·글자 자리는 상자 크기에서 계산한다 (가로·세로 모드, 납작한 배치에서 상자 크기가 다르다) */
  P._drawSummonPanel = function () {
    var ctx = this.ctx, C = CONFIG, i, figs = this.assets.get('figs'), list = this.roster[this.tab], full = C.MAX_MAGIC > 0 && this.magicCount() >= C.MAX_MAGIC;
    ctx.textBaseline = 'middle';
    for (i = 0; i < this.tabBoxes.length; i++) { var tb = this.tabBoxes[i], on = i === this.tab;
      if (!this._plateBar(tb.x, tb.y + 2, tb.w, tb.h - 4, on ? 1 : 0.32)) { ctx.fillStyle = on ? '#2c3550' : '#181c27'; ctx.fillRect(tb.x, tb.y, tb.w, tb.h); }   // 원작 이름표(청록 막대): 고른 탭은 밝게, 나머지는 흐리게
      ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = on ? '#f4ffff' : '#8fa3ad'; ctx.fillText(this._fit(C.TABS[i].name, tb.w - 4), tb.x + tb.w / 2, tb.y + tb.h / 2); }
    // 세로 모드 캐러셀 화살표: 넘길 칸이 있는 쪽만 밝게
    var first = this.btnFirst || 0, vis = this.btnVis || this.btnBoxes.length;
    if (this.btnPrev) { var bar = [[this.btnPrev, '◀', first > 0], [this.btnNext, '▶', first < list.length - vis]];
      for (i = 0; i < 2; i++) { var ab2 = bar[i][0], on2 = bar[i][2]; if (!this._cell(ab2.x, ab2.y, ab2.w, ab2.h)) { ctx.fillStyle = on2 ? '#2c3550' : '#181c27'; ctx.fillRect(ab2.x, ab2.y, ab2.w, ab2.h); }
        ctx.textAlign = 'center'; ctx.font = '12px sans-serif'; ctx.fillStyle = on2 ? '#ffe9b0' : '#3f465a'; ctx.fillText(bar[i][1], ab2.x + ab2.w / 2, ab2.y + ab2.h / 2 + 1); } }
    for (var k = 0; k < vis && k < this.btnBoxes.length; k++) { i = first + k; if (i >= list.length) break;
      var b = this.btnBoxes[k], r = list[i], why = this.canSummon(r), ok = !why, cx = b.x + b.w / 2, fh = Math.min(43, b.h - 24), fw = Math.round(fh * 36 / 43);
      if (this._cell(b.x, b.y, b.w, b.h)) { if (ok) { ctx.strokeStyle = r.magic ? 'rgba(127,182,255,.9)' : 'rgba(230,196,118,.9)'; ctx.lineWidth = 1; ctx.strokeRect(b.x + 4.5, b.y + 4.5, b.w - 9, b.h - 9); } }   // 원작 명령 칸 + 뽑을 수 있으면 안쪽 가는 선(마법 유닛 파랑, 그 외 금색)
      else { ctx.fillStyle = ok ? '#232a3a' : '#191d27'; ctx.fillRect(b.x, b.y, b.w, b.h); ctx.strokeStyle = ok ? (r.magic ? '#7fb6ff' : '#c9a35a') : '#3a4152'; ctx.lineWidth = 2; ctx.strokeRect(b.x + 1, b.y + 1, b.w - 2, b.h - 2); }
      ctx.globalAlpha = ok ? 1 : why === 'max' || why === 'nogar' || why === 'castle' ? 0.2 : 0.5; ctx.drawImage(figs, r.t.pid * 36, 0, 36, 43, Math.round(cx - fw / 2), b.y + 2, fw, fh); ctx.globalAlpha = 1;
      if (r.wait > 0) { ctx.fillStyle = 'rgba(0,0,0,.6)'; var ch = b.h * r.wait / r.cd; ctx.fillRect(b.x, b.y + b.h - ch, b.w, ch); }
      ctx.textAlign = 'center';
      ctx.font = '9px sans-serif'; ctx.fillStyle = ok ? '#dfe6f5' : '#7b8397'; ctx.fillText(this._fit(r.t.name, b.w - 4), cx, b.y + b.h - 18);
      ctx.font = 'bold 11px sans-serif'; ctx.fillStyle = this.mana >= r.cost ? '#8fc7ff' : '#e0584a'; ctx.fillText(r.cost, cx, b.y + b.h - 7);
      ctx.font = '9px sans-serif'; ctx.textAlign = 'left'; ctx.fillStyle = '#8a93a8'; ctx.fillText(i + 1, b.x + 4, b.y + 8);
      if (this.selBase) { if (r.gar) { ctx.textAlign = 'right'; ctx.fillStyle = '#ffb36a'; ctx.fillText(r.gar.cls >= 0 ? '사격' : r.gar.bonus > 0 ? '+' + r.gar.bonus : '방어 +' + r.gar.def, b.x + b.w - 4, b.y + 8); } }
      else if (r.magic || r.tech) { ctx.textAlign = 'right'; ctx.fillStyle = r.magic ? '#7fb6ff' : '#ffd36e'; ctx.fillText(r.magic ? '마법' : '기술', b.x + b.w - 4, b.y + 8); }   // 기술 = 알아서 쓰는 몸동작(암살)
      // 마법 유닛 한도에 닿음: 버튼을 어둡게 덮고 "최대" 표시 (눌러도 소환되지 않는다)
      if (r.magic && full && !this.selBase) { ctx.fillStyle = 'rgba(8,10,16,.55)'; ctx.fillRect(b.x + 2, b.y + 2, b.w - 4, b.h - 4);
        ctx.textAlign = 'center'; ctx.font = 'bold 11px sans-serif'; ctx.fillStyle = '#ffb36a'; ctx.fillText('최대', cx, b.y + Math.round(fh * 0.4)); ctx.font = '9px sans-serif'; ctx.fillText(C.MAX_MAGIC + ' / ' + C.MAX_MAGIC, cx, b.y + Math.round(fh * 0.4) + 13); }
    }
  };

  /* 스킬 패널 (캐러셀): 전장의 마법 유닛이 가진 마법 전부가 칸으로 늘어서고, 그중 slotsVis칸(가로 모드 3, 세로 모드 4)이 창에 보인다.
     ◀ ▶ 를 누르거나 칸을 좌우로 끌어 넘긴다. 칸 = 원본 행동 아이콘 + 쿨타임 가림막 + 유닛 번호·이름 + 마법 이름 */
  P._drawSkillPanel = function () {
    var ctx = this.ctx, C = CONFIG, D = this.data.fx.icon, icons = this.assets.get('acticons'), p = this.skillPanel, A = this.slotArea, KEYS = ['A', 'S', 'D', 'F'], self = this;
    var G = this.groups, n = G.length, vis = this.slotsVis, B = this.slotBoxes[0], i, ih = Math.min(D.h, B.h - 22), iw = Math.round(ih * D.w / D.h), T = this.time;
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    // 머리줄: 마법 유닛 수와 마법 종류 수
    ctx.font = '10px sans-serif'; ctx.fillStyle = '#7b8397'; ctx.fillText('아군 ' + this._alive(0).length + '기' + (n ? ' · 마법 유닛 ' + this.magicUnits.length + '기 · 마법 ' + n + '종' : ''), p.x + 2, p.y + p.h / 2);   // 지금 전장에 있는 아군 수 (2026-11-12)
    // ◀ ▶ : 넘길 칸이 있는 쪽만 밝게
    var arrows = [[this.slotPrev, '◀', this.slotFirst > 0], [this.slotNext, '▶', this.slotFirst < n - vis]];
    for (i = 0; i < 2; i++) { var ab = arrows[i][0], on = arrows[i][2];
      if (!this._cell(ab.x, ab.y, ab.w, ab.h)) { ctx.fillStyle = on ? '#2c3550' : '#181c27'; ctx.fillRect(ab.x, ab.y, ab.w, ab.h); }
      ctx.textAlign = 'center'; ctx.font = '11px sans-serif'; ctx.fillStyle = on ? '#ffe9b0' : '#3f465a'; ctx.fillText(arrows[i][1], ab.x + ab.w / 2, ab.y + ab.h / 2 + 1); }
    // 빈 창: 점선 칸
    if (!n) { for (i = 0; i < vis; i++) { var e = this.slotBoxes[i]; ctx.globalAlpha = 0.55; var drew = this._cell(e.x, e.y, e.w, e.h); ctx.globalAlpha = 1; if (!drew) { ctx.strokeStyle = '#2f3647'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]); ctx.strokeRect(e.x + 1.5, e.y + 1.5, e.w - 3, e.h - 3); ctx.setLineDash([]); }
      ctx.textAlign = 'center'; ctx.font = '9px sans-serif'; ctx.fillStyle = '#4a5268'; ctx.fillText('빈 칸', e.x + e.w / 2, e.y + e.h / 2); } return; }
    // 칸 = 마법 종류 하나 (그 마법을 가진 유닛 수 ×N). 창 밖으로 나간 부분은 잘라낸다
    ctx.save(); ctx.beginPath(); ctx.rect(A.x, A.y, A.w, A.h); ctx.clip();
    for (i = 0; i < n; i++) {
      var g = G[i], vp = (g.vi == null ? i : g.vi) - this.slotPos; if (vp < -1.2 || vp > vis + 0.2) continue;   // 창 밖
      var bx = Math.round(A.x + vp * this.slotStep), cx = bx + B.w / 2, a = g.act, fi = a.icon * 2, vk = i - this.slotFirst, R = this._readyOf(g), s0 = g.slots[0];
      var cd = R.length ? 0 : Math.min.apply(null, g.slots.map(function (q) { return q.cd > 0 ? q.cd : 99; })), stunned = !R.length && cd >= 99;   // 전원 멈춤
      var far = R.length > 0 && !R.some(function (q) { return self.skillTarget(q.unit, q); }), poor = this.mana < g.cost, ok = R.length > 0 && !far && !poor, aiming = this.aim && this.aim.group === g;
      if (this._cell(bx, B.y, B.w, B.h)) { if (ok) { ctx.fillStyle = 'rgba(255,190,80,.10)'; ctx.fillRect(bx + 4, B.y + 4, B.w - 8, B.h - 8); }
        if (aiming || ok) { ctx.strokeStyle = aiming ? '#7fd6ff' : 'rgba(255,211,110,.95)'; ctx.lineWidth = aiming ? 3 : 1; ctx.strokeRect(bx + (aiming ? 2.5 : 4.5), B.y + (aiming ? 2.5 : 4.5), B.w - (aiming ? 5 : 9), B.h - (aiming ? 5 : 9)); } }   // 원작 명령 칸. 쓸 수 있으면 금색 가는 선, 조준 중이면 하늘색 굵은 선
      else { ctx.fillStyle = ok ? '#3a2a12' : '#191d27'; ctx.fillRect(bx, B.y, B.w, B.h); ctx.strokeStyle = aiming ? '#7fd6ff' : ok ? '#ffd36e' : '#3a4152'; ctx.lineWidth = aiming ? 3 : 2; ctx.strokeRect(bx + 1, B.y + 1, B.w - 2, B.h - 2); }   // 조준 중인 칸은 하늘색 굵은 테두리
      ctx.globalAlpha = ok ? 1 : 0.4; ctx.drawImage(icons, (fi % D.cols) * D.w, Math.floor(fi / D.cols) * D.h, D.w, D.h, Math.round(cx - iw / 2), B.y + 1, iw, ih); ctx.globalAlpha = 1;
      if (cd > 0 && cd < 99) {                               // 준비된 유닛이 없다: 가장 빨리 끝나는 유닛의 남은 시간
        ctx.fillStyle = 'rgba(0,0,0,.72)'; ctx.fillRect(bx, B.y, B.w, B.h * cd / s0.cdMax);
        ctx.textAlign = 'center'; ctx.font = 'bold 15px sans-serif'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.9)'; ctx.strokeText(Math.ceil(cd), cx, B.y + Math.round(ih / 2) + 2); ctx.fillStyle = '#fff'; ctx.fillText(Math.ceil(cd), cx, B.y + Math.round(ih / 2) + 2);
        ctx.fillStyle = '#ffd36e'; ctx.fillRect(bx + 2, B.y + B.h - 4, Math.round((B.w - 4) * cd / s0.cdMax), 2); }
      else if (stunned) { ctx.textAlign = 'center'; ctx.font = 'bold 11px sans-serif'; ctx.fillStyle = '#c9d1e3'; ctx.fillText('멈춤', cx, B.y + Math.round(ih / 2) + 2); }
      ctx.textAlign = 'center'; ctx.font = '9px sans-serif';
      ctx.fillStyle = '#dfe6f5'; ctx.fillText(this._fit(a.name, B.w - 6), cx, B.y + B.h - 18);
      if (far) { ctx.fillStyle = '#e08a6a'; ctx.fillText(s0.needsFoe() ? '적이 멀다' : '아군 없음', cx, B.y + B.h - 7); }
      else { ctx.font = 'bold 11px sans-serif'; ctx.fillStyle = poor ? '#e0584a' : '#8fc7ff'; ctx.fillText(g.cost, cx, B.y + B.h - 7); ctx.font = '9px sans-serif'; }   // 마나 값: 모자라면 빨강
      // 왼쪽 위: 단축키(보이는 칸만), 오른쪽 위: 이 마법을 가진 유닛 수 (준비된 수 / 전체)
      var cnt = '×' + g.slots.length; ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'right'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.85)'; ctx.strokeText(cnt, bx + B.w - 4, B.y + 9); ctx.fillStyle = ok ? '#ffd36e' : '#8a93a8'; ctx.fillText(cnt, bx + B.w - 4, B.y + 9);
    }
    ctx.restore();
  };

  /* 글자가 칸보다 길면 끝을 … 로 줄인다 */
  P._fit = function (str, w) { var ctx = this.ctx; if (ctx.measureText(str).width <= w) return str; while (str.length > 1 && ctx.measureText(str + '…').width > w) str = str.slice(0, -1); return str + '…'; };

  /* 시작 / 승리 / 패배 화면. 줄마다 [글, 글자 크기, 색, 위 여백]. 화면보다 긴 줄은 띄어쓰기에서 꺾어 여러 줄로 (세로 모드는 가로가 좁다) */
  P._drawOverlay = function () {
    var ctx = this.ctx, W = this.W, H = this.H, sc = this.screen, G = '#9aa3b8', items;
    ctx.fillStyle = 'rgba(5,7,12,.78)'; ctx.fillRect(0, 0, W, H);
    if (sc === 'title') items = [['거울전쟁 디펜스', 28, '#ffd36e', 0], ['적군을 막아 성을 지키세요', 14, '#dfe6f5', 14],
      ['탭을 골라 해방부대 유닛을 소환합니다', 12, G, 12],
      ['소환 버튼을 길게 누르면 그 유닛의 설명이 나옵니다', 12, G, 6],
      ['오른쪽 위 [상성] 버튼으로 유닛 상성을 볼 수 있습니다', 12, G, 6],
      ['마법 유닛을 소환하면 그 마법이 스킬 칸에 생깁니다 — 같은 마법은 한 칸(×유닛 수), 많으면 좌우로 넘기기', 12, G, 6],
      ['마법도 마나를 씁니다 — 소환과 마법 중 어디에 쓸지 고르세요', 12, G, 6],
      ['적을 쓰러뜨리면 경험치가 쌓이고, 레벨이 오르면 카드 3장 중 하나를 고릅니다', 12, G, 6],
      ['적에게 쓰는 마법은 칸을 누른 뒤 전장에서 쓸 곳을 누릅니다', 12, G, 6],
      ['전장의 마법 유닛을 누르면 [회수] 버튼 — 남은 체력만큼 마나를 돌려받습니다', 12, G, 6],
      ['성을 눌러 고른 동안 궁수·명궁·창검사·마법사·장로를 소환하면 성에 들어가 적을 쏩니다 (4명까지)', 12, G, 6],
      ['전장은 좌우로 깁니다 — 화면을 끌거나 위쪽 막대를 눌러 둘러보세요', 12, G, 6], ['상대할 적군을 고르세요', 16, '#fff', 18], ['@enemy', 40, '', 8],
      // 팬 게임 고지 (사용자 2026-11-12 확정 문구) — 전장 시뮬 페이지 하단과 같은 문장
      ['이 게임은 원작 「거울전쟁」에 대한 팬심으로 만든 비영리 팬 게임입니다.', 10, '#7b8397', 22],
      ['원작 자산의 저작권은 제작사 L&K Logic Korea에 있으며, 요청이 있으면 즉시 내리겠습니다.', 10, '#7b8397', 4]];
    else if (sc === 'win') items = [['스테이지 클리어!', 28, '#8fe89a', 0], ['처치 ' + this.kills + '   ·   남은 기지 체력 ' + Math.ceil(this.baseHp), 14, '#dfe6f5', 14], ['화면을 눌러 처음으로', 16, '#fff', 22]];
    else items = [['게임 오버', 28, '#ff7a6a', 0], ['웨이브 ' + Math.min(this.wave + 1, CONFIG.WAVES.length) + ' 에서 기지가 무너졌습니다', 14, '#dfe6f5', 14], ['화면을 눌러 처음으로', 16, '#fff', 22]];
    var lines = [], total = 0, maxW = W - 28, self = this;
    items.forEach(function (it) { ctx.font = (it[1] <= 10 ? '' : 'bold ') + it[1] + 'px sans-serif';
      self._wrap(it[0], maxW).forEach(function (ln, k) { var gap = k ? 3 : it[3], lh = Math.round(it[1] * 1.25); lines.push([ln, it[1], it[2], gap, lh]); total += gap + lh; }); });
    var y = Math.max(8, Math.round((H - total) / 2));
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    this.enemyBtns = null;
    lines.forEach(function (l) { y += l[3];
      if (l[0] === '@enemy') {   // 적 종족 버튼 (시작 화면): 대표 유닛 그림 + 이름. 지금 고른(직전에 한) 종족은 밝게
        var keys = Object.keys(CONFIG.ENEMIES).sort(function (a, b) { return a === CONFIG.ENEMY_DEFAULT ? -1 : b === CONFIG.ENEMY_DEFAULT ? 1 : 0; }), bw = Math.min(150, Math.floor((W - 36) / keys.length)), bh = l[4], x0 = Math.round(W / 2 - (bw * keys.length + 12 * (keys.length - 1)) / 2), figs = self.assets.get('figs');
        self.enemyBtns = keys.map(function (k, i) { var E = CONFIG.ENEMIES[k], b = { key: k, x: x0 + i * (bw + 12), y: y, w: bw, h: bh }, t = self.types[E.fig];
          self._plate(b.x, b.y, b.w, b.h, 7, k === self.enemy);
          ctx.font = 'bold 16px sans-serif'; var tw = ctx.measureText(E.name).width, cx = Math.round(b.x + (b.w - tw - 34) / 2);
          if (t && figs) ctx.drawImage(figs, t.pid * 36, 0, 36, 43, cx, b.y + Math.round((bh - 34) / 2), 28, 34);
          ctx.textAlign = 'left'; ctx.fillStyle = '#ffe9b0'; ctx.fillText(E.name, cx + 34, b.y + bh / 2 + 1); ctx.textAlign = 'center';
          return b; });
        y += l[4]; return; }
      ctx.font = (l[1] <= 10 ? '' : 'bold ') + l[1] + 'px sans-serif'; ctx.fillStyle = l[2]; ctx.fillText(l[0], W / 2, y + l[4] / 2); y += l[4]; });
    ctx.textAlign = 'left';
  };
  /* 글을 폭 w 안에 들어가게 띄어쓰기에서 나눈다 (지금 ctx.font 기준) */
  P._wrap = function (str, w) {
    var ctx = this.ctx, words = str.split(' '), out = [], line = '';
    words.forEach(function (wd) { var t = line ? line + ' ' + wd : wd; if (line && ctx.measureText(t).width > w) { out.push(line); line = wd; } else line = t; });
    if (line) out.push(line); return out;
  };

  P._center = function (s, y, size, col) { var ctx = this.ctx; ctx.font = 'bold ' + size + 'px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = col; ctx.fillText(s, this.W / 2, y, this.W - 16); ctx.textAlign = 'left'; };

  /* ───────────────────────── 7. 입력 ───────────────────────── */
  /* 화면에서 누른 위치 → 게임 안 좌표. 캔버스가 화면에 맞춰 늘어나 있고(object-fit: contain) 남는 곳은 여백이므로 그만큼 보정한다 */
  P._pos = function (e) {
    var r = this.cv.getBoundingClientRect(), k = Math.min(r.width / this.W, r.height / this.H);
    return [(e.clientX - r.left - (r.width - this.W * k) / 2) / k, (e.clientY - r.top - (r.height - this.H * k) / 2) / k];
  };
  function inBox(b, x, y) { return x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h; }

  P._tap = function (x, y) {
    var i;
    this.sfx.unlock();                                       // 브라우저는 첫 터치 뒤에만 소리를 허락한다
    if (inBox(this.soundBtn, x, y)) { this.toggleSound(); return; }
    if (this.screen === 'play' && this.modal) { if (this.modalT > 0.25) this.modal = null; return; }   // 상성 모달: 아무 곳이나 누르면 닫히고 게임이 이어진다
    if (this.screen === 'play' && !this.cards && inBox(this.affBtn, x, y)) { this.modal = 'aff'; this.modalT = 0; this.aim = null; this.info = null; this.sinfo = null; return; }
    if (this.screen === 'title') {   // 적 종족 버튼을 눌러 시작 (스페이스·엔터는 지금 고른 종족으로)
      if (x < 0) { this.pickEnemy(this.enemy); return; }
      for (i = 0; i < (this.enemyBtns || []).length; i++) if (inBox(this.enemyBtns[i], x, y)) { this.pickEnemy(this.enemyBtns[i].key); break; }
      return; }
    if (this.screen === 'win' || this.screen === 'lose') { this.reset(); this.screen = 'title'; return; }   // 처음 화면으로 — 적 종족을 다시 고른다
    if (this.screen === 'play' && this.cards) { if (this.cardT > 0.35) for (i = 0; i < this.cards.length; i++) if (inBox(this.cards[i].box, x, y)) { this.pickCard(i); break; } return; }   // 카드를 고르는 중: 카드만 누를 수 있다 (뜨자마자 잘못 누르지 않게 0.35초 뒤부터)
    if (this.screen !== 'play') return;
    if (y < this.H - this.hudH) { this._tapField(x, y); return; }   // 전장 (키보드 등으로 들어온 경우 — 포인터는 _bind 가 직접 _tapField 로 보낸다)
    this._aimWas = this.aim ? this.aim.group : null; this.aim = null;   // 아래 패널의 다른 것을 누르면 조준 취소 (같은 스킬 칸이면 pressSlot 이 취소로 처리)
    this.sel = null;                                         // 아래 패널의 무엇이든 누르면 유닛 선택은 풀린다. 성 선택은 소환 패널(탭·버튼·넘기기)을 누르는 동안 유지되고, 스킬 쪽을 누르면 풀린다
    for (i = 0; i < this.tabBoxes.length; i++) if (inBox(this.tabBoxes[i], x, y)) { this.tab = i; this.btnFirst = 0; return; }
    if (this.btnPrev && inBox(this.btnPrev, x, y)) { this._scrollBtns(-1); return; }
    if (this.btnNext && inBox(this.btnNext, x, y)) { this._scrollBtns(1); return; }
    var bi = this.btnIndexAt(x, y); if (bi >= 0) { this.summon(bi); return; }
    this.selBase = false;
    for (i = 0; i < this.chipBoxes.length; i++) if (inBox(this.chipBoxes[i], x, y)) { this.pressChip(i); return; }
    if (inBox(this.slotPrev, x, y)) { this.scrollSlots(-1); return; }
    if (inBox(this.slotNext, x, y)) { this.scrollSlots(1); return; }
    for (i = 0; i < this.slotBoxes.length; i++) if (inBox(this.slotBoxes[i], x, y)) { this.pressVisible(i); return; }
  };

  /* 스킬 칸을 길게 누르면(CONFIG.CAM.holdMs) 마법을 쓰지 않고, 그 마법을 쓸 수 있는 유닛에게 카메라가 간다 (2026-11-12 사용자 요청).
     준비된 유닛이 있으면 그중 맨 앞, 없으면 재사용 대기가 가장 짧은 유닛. 유닛 머리 위에 마법 이름을 잠깐 띄워 누구인지 알려 준다. 손을 떼도 마법은 나가지 않는다 */
  P._holdSlot = function () {
    var d = this.drag; if (!d || !d.slots || d.moved || d.held || this.screen !== 'play' || this.cards || Date.now() - d.t0 < CONFIG.CAM.holdMs) return;
    d.held = true;
    for (var i = 0; i < this.slotBoxes.length; i++) if (inBox(this.slotBoxes[i], d.x, d.y)) {
      var g = this.groups[this.slotFirst + i]; if (!g) return;
      this.sinfo = g;                                        // 누르고 있는 동안 마법 설명 카드 (_drawSkillInfo)
      var rd = this._readyOf(g), L = (rd.length ? rd : g.slots.filter(function (q) { return q.unit && q.unit.state !== 'dead'; })).slice();
      if (!L.length) return;
      L.sort(rd.length ? function (a, b) { return b.unit.x - a.unit.x; } : function (a, b) { return a.cd - b.cd; });
      var u = L[0].unit; this.camGoal = { x: u.x - this.W / 2, until: this.time + CONFIG.CAM.skillSec }; this.manualUntil = 0;
      this._say(u.x, u.y - u.headY - 14, g.act.name + (rd.length ? '' : ' (대기 ' + Math.ceil(L[0].cd) + ')'), '#ffd36e');
      return; }
  };

  /* 소환 버튼을 길게 누르면(CONFIG.CAM.holdMs) 소환하지 않고 그 유닛의 설명 카드를 띄운다. 손을 떼면 사라진다 (2026-11-13: 상성에 맞게 뽑으려면 설명이 필요 — 세로 화면이라 늘 띄워 두지 않고 누르는 동안만) */
  P._holdBtn = function () {
    var d = this.drag; if (!d || !d.btn || d.moved || d.held || this.screen !== 'play' || this.cards || Date.now() - d.t0 < CONFIG.CAM.holdMs) return;
    var i = this.btnIndexAt(d.x, d.y); if (i < 0) return;
    d.held = true; this.info = this.roster[this.tab][i];
  };
  /* 유닛 설명 카드의 내용: 첫 줄은 손으로 쓴 한 줄(MWE.UNIT_DESC), 나머지는 데이터에서 자동으로 — 짧게.
     상성(원본 unitdata 의 강한 상대 목록 aff, 배수 affMul/8)은 이 게임의 적(악령군) 기준으로 묶음 이름을 붙인다 */
  /* 적 종족별 상성 표. name = 아군의 강한 상대 목록(aff)에 든 대표 유닛 번호 → 묶음 이름, fam = [대표, 그 묶음의 적 유닛들],
     rings = 상성 모달의 고리 두 개(시계 방향으로 강하다. open = 마지막 화살표 없음 — 고리가 아니라 사슬), foot = 모달 아래 안내 세 줄.
     흑마술파(원본 aff): 전사류 → 소환·환술류(58~62) → 격투류 → 흡혈귀·늑대인간(63~65) → 전사류 / 성직·소환류 → 전사·도둑류(52~57) → 마법사류 → 구렁이·드래곤·벌레(66~70).
     구렁이·드래곤·개미·거미는 해방부대에 강한 상대가 없고(전갈만 전사류에 강함), 마술사 49~51 은 상성이 아예 없다 */
  var AFF = {
    evil: { name: { 39: '악마류', 35: '흡혈귀·늑대인간·메두사', 43: '짐승·박쥐·드래곤', 28: '언데드' },
      fam: [[39, [39, 40, 41, 42]], [35, [35, 36, 38]], [43, [43, 44, 45, 46, 47]], [28, [28, 29, 30, 31, 32, 33, 48]]],
      rings: [
        [{ n: '전사류', fig: 0, ally: 1, m: '전사·기사·창기사·성기사·궁수·명궁·창검사' }, { n: '악마류', fig: 39, m: '데몬·데빌·사탄·서큐버스' }, { n: '격투류', fig: 8, ally: 1, m: '격투가·무도가·도사·의적' }, { n: '흡혈귀류', fig: 35, m: '흡혈귀·늑대인간·메두사' }],
        [{ n: '마법사류', fig: 12, ally: 1, m: '정령사·마법사·장로·연금술사·마법전사·마법기사' }, { n: '짐승류', fig: 43, m: '늑대·켈베로스·펜릴·박쥐·드래곤' }, { n: '성직·소환류', fig: 19, ally: 1, m: '성령사·사제·주교·소환사·신수사·엔젤 나이트·엔트' }, { n: '언데드', fig: 28, m: '해골전사·해골기사·좀비·듀라한·유령·리치·디아블로' }]],
      foot: ['상성이 맞으면 피해가 1.25~2배가 됩니다 (유닛 설명 카드의 "강함")', '지상 근접 유닛은 공중 유닛(박쥐·드래곤)을 공격할 수 없습니다', '턴 언데드·디스트로이 언홀리·홀리 크로스는 언데드를 멈춥니다'] },
    dark: { name: { 58: '소환·환술류', 63: '흡혈귀·늑대인간', 66: '구렁이·드래곤·벌레', 52: '전사·도둑류' },
      fam: [[58, [58, 59, 60, 61, 62]], [63, [63, 64, 65]], [66, [66, 67, 68, 69, 70]], [52, [52, 53, 54, 55, 56, 57]]],
      rings: [
        [{ n: '전사류', fig: 0, ally: 1, m: '전사·기사·창기사·성기사·궁수·명궁·창검사' }, { n: '소환·환술류', fig: 59, m: '소환사·환술사·연금술사·인챈터·마녀' }, { n: '격투류', fig: 8, ally: 1, m: '격투가·무도가·도사·의적' }, { n: '흡혈귀류', fig: 63, m: '흡혈귀·늑대인간 (전갈도 전사류에 강함)' }],
        [{ n: '성직·소환류', fig: 19, ally: 1, m: '성령사·사제·주교·소환사·신수사·엔젤 나이트·엔트' }, { n: '전사·도둑류', fig: 52, m: '전사·흑전사·흑기사·도둑·대도·마기사' }, { n: '마법사류', fig: 12, ally: 1, m: '정령사·마법사·장로·연금술사·마법전사·마법기사' }, { n: '짐승·벌레류', fig: 66, m: '구렁이·드래곤·개미·거미·전갈' }]],
      open: [0, 1],
      foot: ['상성이 맞으면 피해가 1.25~2배 (마술사 3종은 상성 없음)', '지상 근접 유닛은 공중 유닛(마녀·드래곤)을 공격할 수 없습니다', '흑마술파에는 언데드가 없어 턴 언데드가 통하지 않습니다'] }
  };
  Object.keys(AFF).forEach(function (k) { var A = AFF[k]; A.famOf = {}; A.repOf = {}; A.fam.forEach(function (q) { q[1].forEach(function (id) { A.famOf[id] = A.name[q[0]]; A.repOf[id] = q[0]; }); }); });   // 적 유닛 → 묶음 이름·대표 유닛
  P.unitInfo = function (r) {
    var t = r.t, C = CONFIG, basic = basicAct(t), rng = basic ? basic.range * C.RANGE_SCALE : 0, air = t.fly === 2, L = [];
    var kind = !basic ? '지원(공격 없음)' : rng >= 80 ? '원거리' : '근접';
    L.push((air ? '공중 유닛 · ' : '') + kind + (basic ? (rng >= 80 || air ? ' · 공중 공격 가능' : ' · 공중 공격 불가') : ''));
    var AF = AFF[this.enemy] || AFF.evil, AFF_NAME = AF.name, AFF_FAM = AF.famOf;
    var grp = null; for (var k in AFF_NAME) if ((t.aff || []).indexOf(+k) >= 0) grp = AFF_NAME[k];
    if (grp) L.push('강함: ' + grp + ' ×' + (t.affMul / 8).toFixed(2).replace(/0$/, ''));
    // 약함: 이 게임에 나오는 적 중 이 유닛을 상성으로 잡는 적 (원본 aff — 적의 강한 상대 목록에 이 유닛이 있다). 짧게 세 이름까지
    var weak = [], seen = {}, self = this; C.WAVES.forEach(function (wv) { wv.list.forEach(function (e) { var et = self.types[e[0]]; if (!et || (et.aff || []).indexOf(t.id) < 0 || !basicAct(et)) return; var rep = self.types[AF.repOf[et.id]], fam = rep && (rep.aff || []).indexOf(t.id) >= 0 ? AFF_FAM[et.id] : et.name; if (!seen[fam]) { seen[fam] = 1; weak.push(fam); } }); });   // 강함과 같은 묶음 이름으로
    if (weak.length) L.push('약함: ' + weak.join('·'));
    var sk = skillsOf(t).map(function (a) { return a.name + (C.TECH[a.name] || a.self ? '(자동)' : ''); });
    if (sk.length) L.push('마법: ' + sk.join(', '));
    // 변형 유닛(엔트): 걷는 형태에는 공격이 없어 설명이 없으면 "공격 없는 유닛"으로만 보인다 → 변형하면 무엇이 되는지 적는다 (2026-11-13 사용자 요청)
    var mt = this.types[C.MORPH[t.id]], mb = mt ? basicAct(mt) : null;
    if (mt && mb) { var mr = Math.round(mb.range * C.RANGE_SCALE), ms = skillsOf(mt).filter(function (a) { return skillKind(a) !== 'morph'; }).map(function (a) { return a.name; });
      L.push('변형(스킬 칸, 마나 ' + new SkillSlot({ state: 'idle' }, t.acts.filter(function (a) { return a && a.sup === 'morph'; })[0]).cost + '): 뿌리내려 ' + mb.name + '(사거리 ' + mr + ')' + (ms.length ? '·' + ms.join('·') : '') + ' — 그동안 못 움직임'); }
    var bt = bodyTechs(t).map(function (a) { return a.name === '방패 막기' ? '방패 막기(체력 ' + Math.round(C.BODY_TECH[a.name].hpBelow * 100) + '% 이하에서 방어 ×2, ' + Math.round(C.BODY_TECH[a.name].hpRelease * 100) + '% 이상이면 해제)' : a.name === '창 돌리기' ? '창 돌리기(적 ' + C.BODY_TECH[a.name].foes + '기 이상에 둘러싸이면 둘레 공격)' : a.name; });
    if (bt.length) L.push('기술(자동): ' + bt.join(', '));
    // 사격 보너스 유닛(정령사·연금술사·마법전사·마법기사)은 혼자 넣으면 효과가 없다 — 쏘는 유닛(궁수·명궁·창검사·마법사·장로)과 함께여야 한다
    if (r.gar) { var gp = []; if (r.gar.cls >= 0) gp.push('성·벙커에 넣으면 사격'); else if (r.gar.bonus > 0) gp.push('쏘는 유닛과 함께 넣으면 사격 +' + r.gar.bonus); if (r.gar.def > 0) gp.push('성·벙커에 넣으면 건물 방어 +' + r.gar.def); L.push(gp.join(' · ')); }
    return { name: t.name, cost: r.cost, stat: '체력 ' + t.maxHpAt(1 + (this.allyLv || 0)) + ' · 공격 ' + t.atk + ' · 방어 ' + t.def, desc: (MWE.UNIT_DESC && MWE.UNIT_DESC[t.id]) || '', lines: L };
  };
  /* 마법 설명 카드의 내용 (스킬 칸을 길게 누르면): 손으로 쓴 설명(MWE.DEF_SKILL_DESC)의 {자리}를 CONFIG 값으로 채우고, 종류·마나·범위·시전 거리는 데이터에서 */
  P.skillInfo = function (g) {
    var s = g.slots[0], a = g.act, S = CONFIG.SKILL, tps = this.rules.tps, self = this; if (!s) return null;
    var V = { healMax: S.healMax, healPct: Math.round(S.healRatio * 100), buffMax: S.buffMax, buffSec: S.buffSec, stun: stunSecOf(a), charmMax: S.charmMax, dur: Math.round((a.dur || 600) / tps), undead: S.undeadDmg[a.name] || 0 };
    var desc = ((MWE.DEF_SKILL_DESC && MWE.DEF_SKILL_DESC[a.name]) || '').replace(/\{(\w+)\}/g, function (m, k) { return V[k] != null ? V[k] : m; });
    var L = [], n = g.slots.filter(function (q) { return q.unit && q.unit.state !== 'dead'; }).length;
    if (s.aimed) L.push('칸을 누른 뒤 전장을 찍어 씁니다 · 효과 반경 ' + Math.round(this.aimRadius(s)) + ' · 시전 거리 ' + (s.kind === 'recall' ? '제한 없음' : Math.round(this.aimReach(s))));
    else L.push(a.self || CONFIG.TECH[a.name] ? '유닛이 알아서 씁니다' : '칸을 누르면 바로 씁니다' + (s.kind === 'morph' ? '' : ' · 시전 유닛 주변 ' + S.buffRadius));
    L.push('재사용 ' + S.cool + '초 · 가진 유닛 ' + n + '기' + (s.kind === 'blast' && blastTier(a) > 1 ? ' · 피해 ×' + blastTier(a).toFixed(2).replace(/0$/, '') : ''));
    return { name: a.name, cost: s.cost, kind: KIND_NAME[s.kind] || '', desc: desc, lines: L };
  };
  P._drawSkillInfo = function () {
    var g = this.sinfo; if (!g) return; var I = this.skillInfo(g); if (!I) return;
    var ctx = this.ctx, W = this.W, x = 8, w = W - 16, lh = 15, i;
    ctx.font = '12px sans-serif'; var D = I.desc ? this._wrapAny(I.desc, w - 24) : [], h = 34 + D.length * 16 + I.lines.length * lh + 8, y = this.H - this.hudH - h - 8;
    this._plate(x, y, w, h, 6, false, 'dark');
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.font = 'bold 14px sans-serif'; ctx.fillStyle = '#ffe9b0'; ctx.fillText(I.name, x + 12, y + 17);
    var nw = ctx.measureText(I.name).width; ctx.font = 'bold 12px sans-serif'; ctx.fillStyle = '#8fc7ff'; ctx.fillText('마나 ' + I.cost, x + 12 + nw + 8, y + 17.5);
    ctx.textAlign = 'right'; ctx.font = '11px sans-serif'; ctx.fillStyle = '#ffd36e'; ctx.fillText(I.kind, x + w - 12, y + 17.5); ctx.textAlign = 'left';
    ctx.font = '12px sans-serif'; ctx.fillStyle = '#ffffff'; for (i = 0; i < D.length; i++) ctx.fillText(D[i], x + 12, y + 38 + i * 16);
    ctx.font = '11px sans-serif'; ctx.fillStyle = '#c9d1e3'; for (i = 0; i < I.lines.length; i++) ctx.fillText(this._fit(I.lines[i], w - 24), x + 12, y + 38 + D.length * 16 + 2 + i * lh);
  };
  P._drawInfo = function () {
    var r = this.info; if (!r) return;
    var ctx = this.ctx, I = this.unitInfo(r), W = this.W, x = 8, w = W - 16, lh = 15, h = 57 + I.lines.length * lh, y = this.H - this.hudH - h - 8, i;
    this._plate(x, y, w, h, 6, false, 'dark');
    ctx.drawImage(this.assets.get('figs'), r.t.pid * 36, 0, 36, 43, x + 10, y + 9, 36, 43);
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.font = 'bold 14px sans-serif'; ctx.fillStyle = '#ffe9b0'; ctx.fillText(I.name, x + 54, y + 16);
    var nw = ctx.measureText(I.name).width; ctx.font = 'bold 12px sans-serif'; ctx.fillStyle = '#8fc7ff'; ctx.fillText('마나 ' + I.cost, x + 54 + nw + 8, y + 16.5);
    ctx.textAlign = 'right'; ctx.font = '10px sans-serif'; ctx.fillStyle = '#9aa3b8'; ctx.fillText(I.stat, x + w - 10, y + 16.5); ctx.textAlign = 'left';
    ctx.font = '12px sans-serif'; ctx.fillStyle = '#ffffff'; ctx.fillText(this._fit(I.desc, w - 64), x + 54, y + 35);
    ctx.font = '11px sans-serif';
    for (i = 0; i < I.lines.length; i++) { ctx.fillStyle = /^강함/.test(I.lines[i]) ? '#8fe89a' : /^약함|공중 공격 불가/.test(I.lines[i]) ? '#ffb08a' : '#c9d1e3'; ctx.fillText(this._fit(I.lines[i], w - 24), x + 12, y + 58 + i * lh); }
  };

  /* 유닛 상성 모달 (2026-11-13): 오른쪽 위 [상성] 버튼으로 연다. 떠 있는 동안 게임은 멈추고, 아무 곳이나 누르면 닫힌다.
     원본 상성(unitdata 의 강한 상대 목록)은 고리 두 개다 — 화살표 방향으로 강하다. 아군 묶음은 초록, 적 묶음은 빨강. 묶음마다 대표 유닛 그림과 구성원 */
  P._drawAff = function () {
    var ctx = this.ctx, W = this.W, H = this.H, figs = this.assets.get('figs'), self = this, x0 = 8, w = W - 16, y0 = 44, foot = 78, h = H - y0 - 12, rh = Math.floor((h - 40 - foot) / 2), nw = Math.floor((w - 24 - 40) / 2), nh = Math.floor((rh - 44) / 2), r, k, AF = AFF[this.enemy] || AFF.evil, AFF_RINGS = AF.rings;
    ctx.fillStyle = 'rgba(4,6,10,.72)'; ctx.fillRect(0, 0, W, H);
    this._plate(x0, y0, w, h, 8, false);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = 'bold 15px sans-serif'; ctx.fillStyle = '#ffe9b0'; ctx.fillText('유닛 상성 (적: ' + CONFIG.ENEMIES[this.enemy].name + ') — 화살표 방향으로 강합니다', W / 2, y0 + 20);
    var node = function (q, nx, ny) {
      ctx.fillStyle = q.ally ? 'rgba(40,110,60,.35)' : 'rgba(140,40,34,.35)'; ctx.fillRect(nx, ny, nw, nh); ctx.strokeStyle = q.ally ? '#58e86a' : '#ff7a6a'; ctx.lineWidth = 1; ctx.strokeRect(nx + 0.5, ny + 0.5, nw - 1, nh - 1);
      var t = self.types[q.fig]; ctx.drawImage(figs, (t ? t.pid : q.fig) * 36, 0, 36, 43, nx + 6, ny + 6, 30, 36);
      ctx.textAlign = 'left'; ctx.font = 'bold 13px sans-serif'; ctx.fillStyle = q.ally ? '#8fe89a' : '#ff9a8a'; ctx.fillText(q.n, nx + 42, ny + 16);
      ctx.font = '10px sans-serif'; ctx.fillStyle = '#9aa3b8'; ctx.fillText(q.ally ? '아군' : '적', nx + 42, ny + 32);
      ctx.font = '10px sans-serif'; ctx.fillStyle = '#dfe6f5'; var L = self._wrapAny(q.m, nw - 12); for (var i = 0; i < L.length && i < 3; i++) ctx.fillText(L[i], nx + 6, ny + 52 + i * 13);
    };
    var arrow = function (ax, ay, bx, by) { var a = Math.atan2(by - ay, bx - ax); ctx.strokeStyle = '#ffd36e'; ctx.fillStyle = '#ffd36e'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx - Math.cos(a) * 6, by - Math.sin(a) * 6); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx - Math.cos(a - 0.5) * 11, by - Math.sin(a - 0.5) * 11); ctx.lineTo(bx - Math.cos(a + 0.5) * 11, by - Math.sin(a + 0.5) * 11); ctx.closePath(); ctx.fill(); };
    for (r = 0; r < 2; r++) { var R = AFF_RINGS[r], ry = y0 + 40 + r * rh, lx = x0 + 12, rx = x0 + w - 12 - nw, ty = ry, by = ry + nh + 36;
      // 시계 방향: 왼쪽 위(아군) → 오른쪽 위(적) → 오른쪽 아래(아군) → 왼쪽 아래(적) → 왼쪽 위
      node(R[0], lx, ty); node(R[1], rx, ty); node(R[2], rx, by); node(R[3], lx, by);
      arrow(lx + nw + 4, ty + nh / 2, rx - 4, ty + nh / 2); arrow(rx + nw / 2, ty + nh + 4, rx + nw / 2, by - 4); arrow(rx - 4, by + nh / 2, lx + nw + 4, by + nh / 2); if (!(AF.open && AF.open[r])) arrow(lx + nw / 2, by - 4, lx + nw / 2, ty + nh + 4);   // open = 사슬(마지막 묶음은 처음 묶음에 강하지 않다)
      if (r === 0) { ctx.strokeStyle = 'rgba(255,233,176,.18)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x0 + 16, ry + rh - 4.5); ctx.lineTo(x0 + w - 16, ry + rh - 4.5); ctx.stroke(); } }
    var fy = y0 + h - foot + 4; ctx.textAlign = 'center'; ctx.font = '11px sans-serif'; ctx.fillStyle = '#c9d1e3';
    AF.foot.forEach(function (t, i) { ctx.fillText(self._fit(t, w - 20), W / 2, fy + 8 + i * 16); });
    ctx.font = 'bold 12px sans-serif'; ctx.fillStyle = '#ffd36e'; ctx.fillText('아무 곳이나 누르면 닫힙니다', W / 2, y0 + h - 14);
    ctx.textAlign = 'left';
  };

  /* 진행 막대를 누르거나 그 위에서 끌면: 그 지점이 화면 가운데에 오도록 카메라를 옮긴다 */
  P._miniPan = function (x) { var m = this.miniBox; this.panTo((x - m.x) / m.w * CONFIG.WORLD_W - this.W / 2); };

  /* 적 종족을 바꾼다: 웨이브 표를 갈아 끼우고, 그 종족의 유닛 그림·이펙트 시트 중 아직 안 받은 것을 받는다 (처음에는 기본 종족 것만 받아 둔다 — 한 종족에 3MB쯤) */
  P.setEnemy = function (key) {
    var E = CONFIG.ENEMIES[key], self = this, A = this.assets; if (!E) return false;
    this.enemy = key; CONFIG.WAVES = E.waves;
    this._usedUnitIds().forEach(function (id) { var t = self.types[id]; if (!t) return;
      if (!A.img['u' + id]) A.load('u' + id, t.img);
      t.acts.forEach(function (a) { var d = a && a.arm >= 0 ? self.data.fx.arms[a.arm] : null; (d && d.sheets || []).forEach(function (n) { self._loadFxSheet(n); }); }); });
    return true;
  };
  P.pickEnemy = function (key) { if (this.setEnemy(key)) this.start(); };
  P.start = function () {
    if (this.assets.ready()) { this._pendStart = false; this.reset(); this.screen = 'play'; }
    else { this._pendStart = true; this.screen = 'loading'; }   // 고른 종족의 그림을 받는 중: 다 오면 _frame 이 시작한다
    if (this.soundOn && !this.bgm.on) { this.bgm.set(0); this.bgm.toggle(); }
    // 휴대폰: 전체 화면을 시도한다 (지원하지 않는 브라우저에서는 조용히 넘어간다). 세로 전용
    try { var el = document.documentElement, p = root.matchMedia && root.matchMedia('(pointer: coarse)').matches && el.requestFullscreen ? el.requestFullscreen() : null;
      var lock = function () { try { var o = root.screen && root.screen.orientation; if (o && o.lock) { var q = o.lock('portrait'); if (q && q.catch) q.catch(function () {}); } } catch (e2) {} };   // 세로 고정 (안드로이드 Chrome 전체 화면에서만 됨, iOS Safari 는 무시)
      if (p && p.then) p.then(lock, function () {}); else lock(); } catch (err) {}
  };

  P.toggleSound = function () { this.soundOn = !this.soundOn; this.sfx.on = this.soundOn; if (this.bgm.on !== this.soundOn && this.screen !== 'title') this.bgm.toggle(); };

  /* 단축키 (PC): 1~7 소환, Q·W·E·R 탭, A·S·D 보이는 스킬 칸, Z·X 스킬 칸 넘기기, ←·→ 카메라, M 소리, 스페이스·엔터 시작/다시 하기 */
  P._bind = function () {
    var self = this, cv = this.cv;
    /* 누르기: 버튼이면 바로 실행, 진행 막대면 그곳으로 이동, 전장이면 끌어서 카메라 옮기기 시작 */
    cv.addEventListener('pointerdown', function (e) {
      e.preventDefault(); var p = self._pos(e), x = p[0], y = p[1], m = self.miniBox; if (self.aim) self.aimPt = { x: x, y: y };
      if (self.screen === 'play' && (self.cards || self.modal || inBox(self.affBtn, x, y))) { self.sfx.unlock(); self._tap(x, y); return; }   // 카드를 고르는 중, 상성 모달, [상성] 버튼
      if (self.screen === 'play' && x >= m.x - 6 && x <= m.x + m.w + 6 && y >= m.y - 6 && y <= m.y + m.h + 6) { self.drag = { mini: true, id: e.pointerId }; self._miniPan(x); return; }
      // 전장: 손을 뗄 때까지 지켜본다 — 6px 넘게 끌면 카메라 이동(그때부터 따라온다), 끌지 않고 떼면 탭(유닛 선택·회수 버튼)
      if (self.screen === 'play' && y < self.H - self.hudH && !inBox(self.soundBtn, x, y)) { self.sfx.unlock(); self.drag = { field: true, x: x, y: y, cam: self.cam.x, moved: false, id: e.pointerId }; try { cv.setPointerCapture(e.pointerId); } catch (err) {} return; }
      // 스킬 칸·소환 줄 위: 바로 누르지 않고, 손을 뗄 때까지 지켜본다 — 그대로 떼면 "누르기", 옆으로 끌면 "캐러셀 넘기기" (HUD 안이라 카메라 이동과 겹치지 않는다)
      if (self.screen === 'play' && inBox(self.slotArea, x, y)) { self.sfx.unlock(); self.drag = { slots: true, x: x, y: y, first: self.slotFirst, moved: false, id: e.pointerId, t0: Date.now() }; try { cv.setPointerCapture(e.pointerId); } catch (err) {} return; }
      if (self.screen === 'play' && self.btnArea && y >= self.btnArea.y && y <= self.btnArea.y + self.btnArea.h) { self.sfx.unlock(); self.drag = { btn: true, x: x, y: y, first: self.btnFirst, moved: false, id: e.pointerId, t0: Date.now() }; try { cv.setPointerCapture(e.pointerId); } catch (err) {} return; }
      self._tap(x, y);
    });
    cv.addEventListener('pointermove', function (e) {
      var p = self._pos(e); if (self.aim) self.aimPt = { x: p[0], y: p[1] };   // 조준 중: 가리키는 곳에 반경 원 (마우스는 움직이기만 해도, 터치는 누르고 있는 동안)
      var d = self.drag; if (!d || d.id !== e.pointerId) return;
      if (d.mini) self._miniPan(p[0]);
      else if (d.slots) { var dx = p[0] - d.x; if (Math.abs(dx) > 8) d.moved = true; if (d.moved) { self.slotFirst = d.first; self.scrollSlots(-Math.round(dx / self.slotStep)); } }
      else if (d.btn) { var bx = p[0] - d.x; if (Math.abs(bx) > 8) d.moved = true; if (d.moved) { self.btnFirst = d.first; self._scrollBtns(-Math.round(bx / self.btnStep)); } }
      else if (d.field) { if (!d.moved && Math.hypot(p[0] - d.x, p[1] - d.y) > 6) d.moved = true; if (d.moved) self.panTo(d.cam - (p[0] - d.x)); }   // 끌기로 판정된 뒤에만 전장이 손가락을 따라온다 (손가락 떨림에 화면이 밀려 탭이 어긋나지 않게)
    });
    var endDrag = function (e) { var d = self.drag; if (!d || d.id !== e.pointerId) return; self.drag = null; self.info = null; self.sinfo = null;   // 손을 떼면 유닛 설명 카드는 사라진다
      if ((d.slots || d.btn) && !d.moved && !d.held && e.type === 'pointerup') self._tap(d.x, d.y);   // 끌지 않고 뗐다 = 그 칸을 눌렀다
      if (d.field && !d.moved && e.type === 'pointerup') self._tapField(d.x, d.y); };   // 전장을 끌지 않고 뗐다 = 탭
    cv.addEventListener('pointerup', endDrag); cv.addEventListener('pointercancel', endDrag);
    cv.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    root.addEventListener('resize', function () { self._resize(); });
    root.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); if (self.screen === 'play') self.panTo(self.cam.x + (e.key === 'ArrowLeft' ? -90 : 90)); return; }
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      var kc = /^Key[A-Z]$/.test(e.code) ? e.code.charAt(3) : null;   // 한글 입력 상태와 상관없이 자판 위치로
      if (e.code === 'Space' || e.key === 'Enter') { e.preventDefault(); if (self.screen !== 'play' && self.screen !== 'loading') self._tap(-1, -1); return; }
      self.sfx.unlock();
      if (/^Digit[1-9]$/.test(e.code)) { self.summon(+e.code.charAt(5) - 1); return; }
      var ti = 'QWER'.indexOf(kc);   // 스킬 단축키(A·S·D·F, Z·X)는 뺐다 — 모바일 게임이라 (2026-11-13 사용자 요청)
      if (kc && ti >= 0 && ti < CONFIG.TABS.length) { self.tab = ti; self.btnFirst = 0; }
      else if (kc === 'M') self.toggleSound();
      else if (e.key === 'Escape') { self.aim = null; self.sel = null; }   // 조준·선택 취소
      else if (kc === 'G' && self.screen === 'play') self.selectBase(!self.selBase);   // 성 고르기/풀기
    });
    // 다른 탭으로 가면 멈춘다
    document.addEventListener('visibilitychange', function () { self.paused = document.hidden; });
  };

  DefenseGame.CONFIG = CONFIG; DefenseGame.AFF = AFF; DefenseGame.SkillSlot = SkillSlot;
  DefenseGame.bodyTechs = bodyTechs; DefenseGame.summonCost = summonCost; DefenseGame.skillKind = skillKind; DefenseGame.skillsOf = skillsOf; DefenseGame.KIND_NAME = KIND_NAME; DefenseGame.blastTier = blastTier; DefenseGame.stunSecOf = stunSecOf;   // 명세 생성기(tools/specbuild.js)가 게임과 같은 식을 쓰도록 내놓는다
  MWE.DefenseGame = DefenseGame;
})(window);
