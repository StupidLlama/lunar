# 后羿射日 — 中秋 2D 平台射擊小遊戲

倉鼠后羿要把天上的 9 顆賤笑太陽打到只剩 1 顆。太陽下山之後,月亮才會出來——中秋快樂!

**線上試玩:https://stupidllama.github.io/lunar/**

## 玩法

| 按鍵 | 動作 |
|---|---|
| A / D(或 ← →) | 左右移動 |
| W(或 ↑) | 跳躍 |
| S(或 ↓) | 從平台往下跳 |
| 空白鍵(按住) | 射箭,自動瞄準最近的太陽 |
| 滑鼠點擊 | 揮兔劍,清掉身邊的火球(冷卻 5 秒) |
| Shift | 月光衝刺,衝刺瞬間無敵(冷卻 4 秒) |

- 撿掉下來的月餅可以拿到隨機 buff:連射 / 雙箭 / 無敵 / 回血
- 太陽會丟火球、追蹤火球、在你腳下放灼熱警戒圈、快死時迴光返照,還會幾顆一起發合體雷射
- 太陽越少天色越暗,但只要天上還有太陽就不會真的天黑;打到剩最後一顆就過關

## 怎麼執行

不需要安裝任何東西,也沒有 build 步驟。

- **直接玩**:用瀏覽器打開 `index.html`
- **本機開伺服器**(可選):在專案資料夾執行 `python -m http.server`,再開 http://localhost:8000

## 部署

用 GitHub Pages:repo 的 Settings → Pages → Source 選 `main` branch、`/ (root)`。之後每次 `git push`,線上版本大約一兩分鐘內就會更新。

## 測試

遊戲的數值和判定邏輯(重力、單向平台、兔劍範圍、冷卻、光照規則、勝負條件……)都放在 `src/logic.js`,並用 Node 內建的測試工具寫了 20 個單元測試,每個測試都對應 `SPEC.md` 的一條規則:

```bash
node --test
```

需要 Node 18 以上。

## 專案結構

```
├── index.html          遊戲頁面
├── src/
│   ├── logic.js        純邏輯與數值(可以單獨測試)
│   ├── game.js         畫面繪製、輸入、遊戲流程
│   └── style.css
├── assets/             圖片素材 + platforms.json(平台碰撞資料)
├── tests/
│   └── logic.test.js   單元測試
├── SPEC.md             規格書(SDD)
└── README.md
```

## 開發方式

這份作業採用 SDD(規格驅動開發):先把玩法、數值、驗收標準寫在 `SPEC.md`,再交給 AI(Claude)實作,最後對照規格驗收。詳細的規格和版本紀錄都在 `SPEC.md`。

## 素材來源

- 弓、箭、火球:[Kenney — Scribble Platformer](https://kenney.nl/assets/scribble-platformer)(CC0),有調整顏色
- 倉鼠、月餅、兔子、太陽臉:作者自己提供的圖片
- 背景、太陽外型、特效:用程式繪製
