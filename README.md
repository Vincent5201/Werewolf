# A Werewolf Game / 狼人殺

[https://warewolf.onrender.com](https://warewolf.onrender.com)

## Technical Stack / 使用技術

* **Backend:** Node.js, Express.js
* **Real-time Communication:** Socket.IO
* **Frontend:** Vanilla JavaScript, HTML5, CSS3
* **Deployment:** Render
* **架構:** 基於 Socket.IO 的事件驅動 (Event-driven) 即時架構，透過伺服器記憶體維護遊戲狀態 (State Management)。

## Implemented Features / 現有功能

* **Core Game Flow:** Night phase, day discussion, day voting, and last words. / 核心遊戲進程，包含夜晚階段、白天討論、投票及遺言階段。
* **Roles:** Seer, Witch, Hunter, Guard, Idiot, Wolf King, Werewolf. / 角色技能實作：預言家、女巫、獵人、守衛、白癡、狼王、狼人。
* **Sheriff System:** Elections, determining speech order, and the Sheriff’s Badge. / 警長系統：包含競選、指定發言順序、移交警徽。
* **Lobby System:** Join/host via specific room IDs. / 房間系統：支援玩家透過網頁連線開房、設置房號。
* **Customization:** Configurable role distribution. / 支援自由調整各角色配置數量。
* **Logs:** Text-based records of the game process. / 遊戲過程文字化紀錄。

## To-Do List / 待開發項目

* Speech time limits / 發言時間限制
* Voice chat functionality / 語音對話功能
* Self-destruction / Explode mechanism / 狼人自爆機制
* Additional roles / 更多角色擴充
* UI/UX Design refinement / UI 視覺設計優化

## Note / 備註

* **Current Limitation:** Error-handling (fool-proofing) is not yet fully implemented. Players must follow the standard procedure; otherwise, errors may occur. / 目前限制：防呆機制尚未完善，玩家需依照正常流程進行操作，否則可能會發生執行錯誤。
* This is a personal practice project, developed with the assistance of LLMs. / 本專案為個人練習作品，開發過程中使用大型語言模型 (LLM) 輔助製作。
