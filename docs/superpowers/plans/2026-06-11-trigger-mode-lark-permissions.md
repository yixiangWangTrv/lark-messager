# Trigger Mode Lark Permissions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show required and optional Lark permission hints for each trigger mode in the dashboard `Settings` panel without changing trigger-mode backend behavior.

**Architecture:** Keep permission metadata in `dashboard/index.html` as a single frontend mapping keyed by trigger mode. Render the permission hints into each existing trigger-mode card and localize only the `Required` and `Optional` labels while leaving permission identifiers untouched.

**Tech Stack:** Plain HTML, vanilla JavaScript, existing dashboard i18n helpers, Node.js built-in test runner.

---

## File Structure

- Modify: `dashboard/index.html`
  Responsibility: define the trigger-mode permission metadata, render the new permission hint rows in the settings cards, and add localized labels for `Required` and `Optional`.
- Modify: `test/dashboard-server.test.js`
  Responsibility: verify the served dashboard HTML includes the new permission-label localization keys and permission-hint hooks so the UI contract is covered by an automated test.

### Task 1: Add A Failing Dashboard HTML Test

**Files:**
- Modify: `test/dashboard-server.test.js`
- Test: `test/dashboard-server.test.js`

- [ ] **Step 1: Write the failing test**

Add this test near the existing dashboard HTTP endpoint tests:

```js
  it("serves trigger mode permission hint labels and placeholders in dashboard html", async () => {
    const res = await fetch(`${baseUrl}/`);
    assert.equal(res.status, 200);

    const html = await res.text();
    assert.match(html, /requiredPermissions:"Required"/);
    assert.match(html, /optionalPermissions:"Optional"/);
    assert.match(html, /id="mentionBotPermissions"/);
    assert.match(html, /id="mentionOwnerPermissions"/);
    assert.match(html, /id="allMessagesPermissions"/);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test test/dashboard-server.test.js
```

Expected: FAIL because the dashboard HTML does not yet include the new localization keys or permission container ids.

- [ ] **Step 3: Commit the failing test**

```bash
git add test/dashboard-server.test.js
git commit -m "test: cover trigger mode permission hints"
```

### Task 2: Render Permission Hints In The Settings Cards

**Files:**
- Modify: `dashboard/index.html`
- Test: `test/dashboard-server.test.js`

- [ ] **Step 1: Add permission hint containers to the trigger mode cards**

In the `Trigger Modes` card markup, add one container under each `.toggle-desc` block:

```html
          <div class="toggle-desc">Bot responds when someone @mentions it directly in a group chat.</div>
          <div class="note trigger-permissions" id="mentionBotPermissions"></div>
```

```html
          <div class="toggle-desc">Bot responds when someone @mentions you (the owner) in a group where the bot is present.</div>
          <div class="note trigger-permissions" id="mentionOwnerPermissions"></div>
```

```html
          <div class="toggle-desc">Bot responds to every message in group chats. High volume — use carefully.</div>
          <div class="note trigger-permissions" id="allMessagesPermissions"></div>
```

- [ ] **Step 2: Add the centralized permission metadata mapping**

Place this near the other top-level dashboard state/constants in the script section:

```js
const TRIGGER_MODE_PERMISSION_HINTS={
  mention_bot:{
    required:["im:message.group_at_msg"],
    optional:["im:message"]
  },
  mention_owner:{
    required:["im:message.group_at_msg"],
    optional:["contact:user.base:readonly"]
  },
  all_messages:{
    required:["im:message"],
    optional:["im:message.group_at_msg"]
  },
};
```

If the exact permission strings differ based on confirmed Lark naming in the codebase or operational docs, substitute the correct strings here before implementation. Keep the same object shape.

- [ ] **Step 3: Add localized labels for the permissions block**

Add these i18n entries to every language dictionary in `dashboard/index.html`:

```js
requiredPermissions:"Required",
optionalPermissions:"Optional",
```

```js
requiredPermissions:"必需权限",
optionalPermissions:"可选权限",
```

```js
requiredPermissions:"Perlu",
optionalPermissions:"Opsional",
```

```js
requiredPermissions:"Maer Bae",
optionalPermissions:"Ecet",
```

Keep permission identifiers themselves untranslated.

- [ ] **Step 4: Implement the permission-hint renderer**

Add these helpers near the trigger-mode functions:

```js
function formatTriggerPermissionHints(hints){
  if(!hints)return "";
  const lines=[];
  if(Array.isArray(hints.required)&&hints.required.length){
    lines.push(`${t("requiredPermissions")}: ${hints.required.join(", ")}`);
  }
  if(Array.isArray(hints.optional)&&hints.optional.length){
    lines.push(`${t("optionalPermissions")}: ${hints.optional.join(", ")}`);
  }
  return lines.join("\n");
}

function renderTriggerPermissionHints(){
  const targets=[
    ["mentionBotPermissions","mention_bot"],
    ["mentionOwnerPermissions","mention_owner"],
    ["allMessagesPermissions","all_messages"],
  ];
  for(const [elementId,modeKey] of targets){
    const el=document.getElementById(elementId);
    if(!el)continue;
    el.textContent=formatTriggerPermissionHints(TRIGGER_MODE_PERMISSION_HINTS[modeKey]);
  }
}
```

This keeps rendering separate from `loadTriggerModes()` and lets language refresh re-render labels without touching checkbox state.

- [ ] **Step 5: Call the renderer during init and language refresh**

Add one call in `init()` after `loadTriggerModes()` and one call inside `refreshUILang()` after the trigger-mode descriptions are refreshed:

```js
  await loadTriggerModes();
  renderTriggerPermissionHints();
  refreshUILang();
```

```js
  if(allDesc)allDesc.textContent=t("allMsgDesc");
  renderTriggerPermissionHints();
  const saveTmBtn=document.querySelector("#panel-settings .card:first-child button");
```

This preserves the current page flow while ensuring translated labels refresh correctly.

- [ ] **Step 6: Run the dashboard test to verify it passes**

Run:

```bash
node --test test/dashboard-server.test.js
```

Expected: PASS, including the new HTML contract test.

- [ ] **Step 7: Manually verify the settings UI in the browser**

Run:

```bash
node oncall-bot.js
```

Then open the dashboard and verify:

- each trigger mode card shows a `Required` line
- modes with optional permissions show an `Optional` line
- permission identifiers are unchanged across language switches
- toggling and saving trigger modes still works

Expected: permission hints render as muted text under each trigger mode description and do not interfere with the existing toggle cards.

- [ ] **Step 8: Commit the implementation**

```bash
git add dashboard/index.html test/dashboard-server.test.js
git commit -m "feat: show lark permissions for trigger modes"
```

## Self-Review

- Spec coverage: the plan covers centralized frontend metadata, permission rendering per card, localized `Required` and `Optional` labels, and preservation of the existing trigger-mode API/save flow.
- Placeholder scan: the only conditional note is the exact permission-string substitution in Task 2 Step 2, which must be resolved before implementation if the confirmed permission names differ from the proposed strings.
- Type consistency: the plan consistently uses `TRIGGER_MODE_PERMISSION_HINTS`, `formatTriggerPermissionHints()`, `renderTriggerPermissionHints()`, and the DOM ids `mentionBotPermissions`, `mentionOwnerPermissions`, and `allMessagesPermissions`.
