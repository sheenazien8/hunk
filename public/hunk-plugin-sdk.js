(function () {
  var TOKENS = ["background", "foreground", "card", "card-foreground", "popover", "popover-foreground", "primary", "primary-foreground",
    "secondary", "secondary-foreground", "muted", "muted-foreground", "accent", "accent-foreground", "destructive", "border", "input", "ring", "radius",
    "font-sans", "font-mono"]
  var listeners = []
  var hunk = { context: null }

  function send(message) {
    window.parent.postMessage(message, location.origin)
  }

  function applyTheme(context) {
    var root = document.documentElement
    root.classList.toggle("dark", context.theme === "dark")
    try {
      var style = window.parent.getComputedStyle(window.parent.document.documentElement)
      TOKENS.forEach(function (name) {
        var value = style.getPropertyValue("--" + name)
        if (value) root.style.setProperty("--hunk-" + name, value)
      })
    } catch {}
  }

  window.addEventListener("message", function (e) {
    if (e.source !== window.parent || e.origin !== location.origin) return
    if (!e.data || e.data.type !== "hunk:context") return
    hunk.context = e.data
    applyTheme(e.data)
    listeners.forEach(function (fn) { fn(e.data) })
  })

  hunk.onContext = function (fn) {
    listeners.push(fn)
    if (hunk.context) fn(hunk.context)
  }
  hunk.openFile = function (path, line) { send({ type: "hunk:openFile", path: path, line: line }) }
  hunk.toast = function (message, ok) { send({ type: "hunk:toast", message: message, ok: ok !== false }) }
  hunk.refresh = function () { send({ type: "hunk:refresh" }) }
  hunk.startAgentTask = function (text, files) { send({ type: "hunk:agentTask", text: text, files: files || [] }) }
  hunk.url = function (path, params) {
    var base = location.pathname.match(/^\/plugins\/[^/]+/)[0]
    var query = new URLSearchParams(params || {})
    if (hunk.context && !query.has("repo")) query.set("repo", hunk.context.repo)
    return base + "/" + String(path).replace(/^\//, "") + "?" + query.toString()
  }

  window.hunk = hunk
  send({ type: "hunk:ready" })
})()
