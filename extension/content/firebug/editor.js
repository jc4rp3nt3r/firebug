/* See license.txt for terms of usage */

FBL.ns(function() { with (FBL) {

// ************************************************************************************************
// Constants

const saveTimeout = 400;
const pageAmount = 10;

// ************************************************************************************************
// Globals

var currentTarget = null;
var currentGroup = null;
var currentPanel = null;
var currentEditor = null;

var defaultEditor = null;

var originalClassName = null;

var originalValue = null;
var defaultValue = null;
var previousValue = null;

var invalidEditor = false;
var ignoreNextInput = false;

// ************************************************************************************************

Firebug.Editor = extend(Firebug.Module,
{
    supportsStopEvent: true,

    dispatchName: "editor",
    tabCharacter: "    ",

    startEditing: function(target, value, editor)
    {
        this.stopEditing();

        if (hasClass(target, "insertBefore") || hasClass(target, "insertAfter"))
            return;

        var panel = Firebug.getElementPanel(target);
        if (!panel.editable)
            return;

        if (FBTrace.DBG_EDITOR)
            FBTrace.sysout("editor.startEditing " + value, target);

        defaultValue = target.getAttribute("defaultValue");
        if (value == undefined)
        {
            value = target.textContent;
            if (value == defaultValue)
                value = "";
        }

        originalValue = previousValue = value;

        invalidEditor = false;
        currentTarget = target;
        currentPanel = panel;
        currentGroup = getAncestorByClass(target, "editGroup");

        currentPanel.editing = true;

        var panelEditor = currentPanel.getEditor(target, value);
        currentEditor = editor ? editor : panelEditor;
        if (!currentEditor)
            currentEditor = getDefaultEditor(currentPanel);

        var inlineParent = getInlineParent(target);
        var targetSize = getOffsetSize(inlineParent);

        setClass(panel.panelNode, "editing");
        setClass(target, "editing");
        if (currentGroup)
            setClass(currentGroup, "editing");

        currentEditor.show(target, currentPanel, value, targetSize);
        dispatch(this.fbListeners, "onBeginEditing", [currentPanel, currentEditor, target, value]);
        currentEditor.beginEditing(target, value);
        if (FBTrace.DBG_EDITOR)
            FBTrace.sysout("Editor start panel "+currentPanel.name);
        this.attachListeners(currentEditor, panel.context);
    },

    stopEditing: function(cancel)
    {
        if (!currentTarget)
            return;

        if (FBTrace.DBG_EDITOR)
            FBTrace.sysout("editor.stopEditing cancel:" + cancel+" saveTimeout: "+this.saveTimeout);

        clearTimeout(this.saveTimeout);
        delete this.saveTimeout;

        this.detachListeners(currentEditor, currentPanel.context);

        removeClass(currentPanel.panelNode, "editing");
        removeClass(currentTarget, "editing");
        if (currentGroup)
            removeClass(currentGroup, "editing");

        var value = currentEditor.getValue();
        if (value == defaultValue)
            value = "";

        var removeGroup = currentEditor.endEditing(currentTarget, value, cancel);

        try
        {
            if (cancel)
            {
                dispatch(currentPanel.fbListeners, 'onInlineEditorClose', [currentPanel, currentTarget, removeGroup && !originalValue]);
                if (value != originalValue)
                    this.saveEditAndNotifyListeners(currentTarget, originalValue, previousValue);

                if (removeGroup && !originalValue && currentGroup)
                    currentGroup.parentNode.removeChild(currentGroup);
            }
            else if (!value)
            {
                this.saveEditAndNotifyListeners(currentTarget, null, previousValue);

                if (removeGroup && currentGroup)
                    currentGroup.parentNode.removeChild(currentGroup);
            }
            else
                this.save(value);
        }
        catch (exc)
        {
            ERROR(exc);
        }

        currentEditor.hide();
        currentPanel.editing = false;

        dispatch(this.fbListeners, "onStopEdit", [currentPanel, currentEditor, currentTarget]);
        if (FBTrace.DBG_EDITOR)
            FBTrace.sysout("Editor stop panel "+currentPanel.name);
        currentTarget = null;
        currentGroup = null;
        currentPanel = null;
        currentEditor = null;
        originalValue = null;
        invalidEditor = false;

        return value;
    },

    cancelEditing: function()
    {
        return this.stopEditing(true);
    },

    update: function(saveNow)
    {
        if (this.saveTimeout)
            clearTimeout(this.saveTimeout);

        invalidEditor = true;

        currentEditor.layout();

        if (saveNow)
            this.save();
        else
        {
            var context = currentPanel.context;
            this.saveTimeout = context.setTimeout(bindFixed(this.save, this), saveTimeout);
            if (FBTrace.DBG_EDITOR)
                FBTrace.sysout("editor.update saveTimeout: "+this.saveTimeout);
        }
    },

    save: function(value)
    {
        if (!invalidEditor)
            return;

        if (value == undefined)
            value = currentEditor.getValue();
        if (FBTrace.DBG_EDITOR)
            FBTrace.sysout("editor.save saveTimeout: "+this.saveTimeout+" currentPanel: "+(currentPanel?currentPanel.name:"null"));
        try
        {
            this.saveEditAndNotifyListeners(currentTarget, value, previousValue);

            previousValue = value;
            invalidEditor = false;
        }
        catch (exc)
        {
            if (FBTrace.DBG_ERRORS)
                FBTrace.sysout("editor.save FAILS "+exc, exc);
        }
    },

    saveEditAndNotifyListeners: function(currentTarget, value, previousValue)
    {
        currentEditor.saveEdit(currentTarget, value, previousValue);
        dispatch(this.fbListeners, "onSaveEdit", [currentPanel, currentEditor, currentTarget, value, previousValue]);
    },

    setEditTarget: function(element)
    {
        if (!element)
        {
            dispatch(currentPanel.fbListeners, 'onInlineEditorClose', [currentPanel, currentTarget, true]);
            this.stopEditing();
        }
        else if (hasClass(element, "insertBefore"))
            this.insertRow(element, "before");
        else if (hasClass(element, "insertAfter"))
            this.insertRow(element, "after");
        else
            this.startEditing(element);
    },

    tabNextEditor: function()
    {
        if (!currentTarget)
            return;

        var value = currentEditor.getValue();
        var nextEditable = currentTarget;
        do
        {
            nextEditable = !value && currentGroup
                ? getNextOutsider(nextEditable, currentGroup)
                : getNextByClass(nextEditable, "editable");
        }
        while (nextEditable && !nextEditable.offsetHeight);

        this.setEditTarget(nextEditable);
    },

    tabPreviousEditor: function()
    {
        if (!currentTarget)
            return;

        var value = currentEditor.getValue();
        var prevEditable = currentTarget;
        do
        {
            prevEditable = !value && currentGroup
                ? getPreviousOutsider(prevEditable, currentGroup)
                : getPreviousByClass(prevEditable, "editable");
        }
        while (prevEditable && !prevEditable.offsetHeight);

        this.setEditTarget(prevEditable);
    },

    insertRow: function(relative, insertWhere)
    {
        var group =
            relative || getAncestorByClass(currentTarget, "editGroup") || currentTarget;
        var value = this.stopEditing();

        currentPanel = Firebug.getElementPanel(group);

        currentEditor = currentPanel.getEditor(group, value);
        if (!currentEditor)
            currentEditor = getDefaultEditor(currentPanel);

        currentGroup = currentEditor.insertNewRow(group, insertWhere);
        if (!currentGroup)
            return;

        var editable = hasClass(currentGroup, "editable")
            ? currentGroup
            : getNextByClass(currentGroup, "editable");

        if (editable)
            this.setEditTarget(editable);
    },

    insertRowForObject: function(relative)
    {
        var container = getAncestorByClass(relative, "insertInto");
        if (container)
        {
            relative = getChildByClass(container, "insertBefore");
            if (relative)
                this.insertRow(relative, "before");
        }
    },

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *

    attachListeners: function(editor, context)
    {
        var win = currentTarget.ownerDocument.defaultView;
        win.addEventListener("resize", this.onResize, true);
        win.addEventListener("blur", this.onBlur, true);

        var chrome = Firebug.chrome;

        this.listeners = [
            chrome.keyCodeListen("ESCAPE", null, bind(this.cancelEditing, this)),
        ];

        if (editor.arrowCompletion)
        {
            this.listeners.push(
                chrome.keyCodeListen("UP", null, bindFixed(editor.completeValue, editor, -1)),
                chrome.keyCodeListen("DOWN", null, bindFixed(editor.completeValue, editor, 1)),
                chrome.keyCodeListen("PAGE_UP", null, bindFixed(editor.completeValue, editor, -pageAmount)),
                chrome.keyCodeListen("PAGE_DOWN", null, bindFixed(editor.completeValue, editor, pageAmount))
            );
        }

        if (currentEditor.tabNavigation)
        {
            this.listeners.push(
                chrome.keyCodeListen("RETURN", null, bind(this.tabNextEditor, this)),
                chrome.keyCodeListen("RETURN", isControl, bind(this.insertRow, this, null, "after")),
                chrome.keyCodeListen("TAB", null, bind(this.tabNextEditor, this)),
                chrome.keyCodeListen("TAB", isShift, bind(this.tabPreviousEditor, this))
            );
        }
        else if (currentEditor.multiLine)
        {
            this.listeners.push(
                chrome.keyCodeListen("TAB", null, insertTab)
            );
        }
        else
        {
            this.listeners.push(
                chrome.keyCodeListen("RETURN", null, bindFixed(this.stopEditing, this))
            );

            if (currentEditor.tabCompletion)
            {
                this.listeners.push(
                    chrome.keyCodeListen("TAB", null, bind(editor.completeValue, editor, 1)),
                    chrome.keyCodeListen("TAB", isShift, bind(editor.completeValue, editor, -1)),
                    chrome.keyCodeListen("UP", null, bindFixed(editor.completeValue, editor, -1, true)),
                    chrome.keyCodeListen("DOWN", null, bindFixed(editor.completeValue, editor, 1, true)),
                    chrome.keyCodeListen("PAGE_UP", null, bindFixed(editor.completeValue, editor, -pageAmount, true)),
                    chrome.keyCodeListen("PAGE_DOWN", null, bindFixed(editor.completeValue, editor, pageAmount, true))
                );
            }
        }
    },

    detachListeners: function(editor, context)
    {
        if (!this.listeners)
            return;

        var win = currentTarget.ownerDocument.defaultView;
        win.removeEventListener("resize", this.onResize, true);
        win.removeEventListener("blur", this.onBlur, true);
        win.removeEventListener('input', this.onInput, true);

        var chrome = Firebug.chrome;
        if (chrome)
        {
            for (var i = 0; i < this.listeners.length; ++i)
                chrome.keyIgnore(this.listeners[i]);
        }

        delete this.listeners;
    },

    onResize: function(event)
    {
        currentEditor.layout(true);
    },

    onBlur: function(event)
    {
        if (currentEditor.enterOnBlur && isAncestor(event.target, currentEditor.box))
            this.stopEditing();
    },

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *
    // extends Module

    initialize: function()
    {
        Firebug.Module.initialize.apply(this, arguments);

        this.onResize = bindFixed(this.onResize, this);
        this.onBlur = bind(this.onBlur, this);
    },

    disable: function()
    {
        this.stopEditing();
    },

    showContext: function(browser, context)
    {
        this.stopEditing();
    },

    showPanel: function(browser, panel)
    {
        this.stopEditing();
    }
});

// ************************************************************************************************
// BaseEditor

Firebug.BaseEditor = extend(Firebug.MeasureBox,
{
    getValue: function()
    {
    },

    setValue: function(value)
    {
    },

    show: function(target, panel, value, textSize, targetSize)
    {
    },

    hide: function()
    {
    },

    layout: function(forceAll)
    {
    },

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *
    // Support for context menus within inline editors.

    getContextMenuItems: function(target)
    {
        var items = [];
        items.push({label: "Cut", commandID: "cmd_cut"});
        items.push({label: "Copy", commandID: "cmd_copy"});
        items.push({label: "Paste", commandID: "cmd_paste"});
        return items;
    },

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *
    // Editor Module listeners will get "onBeginEditing" just before this call

    beginEditing: function(target, value)
    {
    },

    // Editor Module listeners will get "onSaveEdit" just after this call
    saveEdit: function(target, value, previousValue)
    {
    },

    endEditing: function(target, value, cancel)
    {
        // Remove empty groups by default
        return true;
    },

    insertNewRow: function(target, insertWhere)
    {
    },
});

// ************************************************************************************************
// InlineEditor

Firebug.InlineEditor = function(doc)
{
    this.initializeInline(doc);
};

Firebug.InlineEditor.prototype = domplate(Firebug.BaseEditor,
{
    enterOnBlur: true,
    outerMargin: 8,
    shadowExpand: 7,

    tag:
        DIV({"class": "inlineEditor"},
            DIV({"class": "textEditorTop1"},
                DIV({"class": "textEditorTop2"})
            ),
            DIV({"class": "textEditorInner1"},
                DIV({"class": "textEditorInner2"},
                    INPUT({"class": "textEditorInner", type: "text",
                        oninput: "$onInput", onkeypress: "$onKeyPress", onoverflow: "$onOverflow",
                        oncontextmenu: "$onContextMenu"}
                    )
                )
            ),
            DIV({"class": "textEditorBottom1"},
                DIV({"class": "textEditorBottom2"})
            )
        ),

    inputTag :
        INPUT({"class": "textEditorInner", type: "text",
            oninput: "$onInput", onkeypress: "$onKeyPress", onoverflow: "$onOverflow"}
        ),

    expanderTag:
        IMG({"class": "inlineExpander", src: "blank.gif"}),

    initialize: function()
    {
        this.fixedWidth = false;
        this.completeAsYouType = true;
        this.tabNavigation = true;
        this.multiLine = false;
        this.tabCompletion = false;
        this.arrowCompletion = true;
        this.noWrap = true;
        this.numeric = false;
    },

    destroy: function()
    {
        this.destroyInput();
    },

    initializeInline: function(doc)
    {
        this.box = this.tag.replace({}, doc, this);
        this.input = this.box.childNodes[1].firstChild.firstChild;  // XXXjjb childNode[1] required
        this.expander = this.expanderTag.replace({}, doc, this);
        this.initialize();
    },

    destroyInput: function()
    {
        // XXXjoe Need to remove input/keypress handlers to avoid leaks
    },

    getValue: function()
    {
        return this.input.value;
    },

    setValue: function(value)
    {
        // It's only a one-line editor, so new lines shouldn't be allowed
        return this.input.value = stripNewLines(value);
    },

    show: function(target, panel, value, targetSize)
    {
        dispatch(panel.fbListeners, "onInlineEditorShow", [panel, this]);
        this.target = target;
        this.panel = panel;

        this.targetSize = targetSize;
        this.targetOffset = getClientOffset(target);

        this.originalClassName = this.box.className;

        var classNames = target.className.split(" ");
        for (var i = 0; i < classNames.length; ++i)
            setClass(this.box, "editor-" + classNames[i]);

        // Make the editor match the target's font style
        copyTextStyles(target, this.box);

        this.setValue(value);

        if (this.fixedWidth)
            this.updateLayout(true);
        else
        {
            this.startMeasuring(target);
            this.textSize = this.measureInputText(value);

            // Correct the height of the box to make the funky CSS drop-shadow line up
            var parent = this.input.parentNode;
            if (hasClass(parent, "textEditorInner2"))
            {
                var yDiff = this.textSize.height - this.shadowExpand;
                parent.style.height = yDiff + "px";
                parent.parentNode.style.height = yDiff + "px";
            }

            this.updateLayout(true);
        }

        this.getAutoCompleter().reset();

        panel.panelNode.appendChild(this.box);
        this.input.select();

        // Insert the "expander" to cover the target element with white space
        if (!this.fixedWidth)
        {
            copyBoxStyles(target, this.expander);

            target.parentNode.replaceChild(this.expander, target);
            collapse(target, true);
            this.expander.parentNode.insertBefore(target, this.expander);
        }

        scrollIntoCenterView(this.box, null, true);
    },

    hide: function()
    {
        this.box.className = this.originalClassName;

        if (!this.fixedWidth)
        {
            this.stopMeasuring();

            collapse(this.target, false);

            if (this.expander.parentNode)
                this.expander.parentNode.removeChild(this.expander);
        }

        if (this.box.parentNode)
        {
            try { this.input.setSelectionRange(0, 0); } catch (exc) {}
            this.box.parentNode.removeChild(this.box);
        }

        delete this.target;
        delete this.panel;
    },

    layout: function(forceAll)
    {
        if (!this.fixedWidth)
            this.textSize = this.measureInputText(this.input.value);

        if (forceAll)
            this.targetOffset = getClientOffset(this.expander);

        this.updateLayout(false, forceAll);
    },

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *

    beginEditing: function(target, value)
    {
    },

    saveEdit: function(target, value, previousValue)
    {
    },

    endEditing: function(target, value, cancel)
    {
        // Remove empty groups by default
        return true;
    },

    insertNewRow: function(target, insertWhere)
    {
    },

    advanceToNext: function(target, charCode)
    {
        return false;
    },

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *

    getAutoCompleteRange: function(value, offset)
    {
    },

    getAutoCompleteList: function(preExpr, expr, postExpr)
    {
    },

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *

    getAutoCompleter: function()
    {
        if (!this.autoCompleter)
        {
            this.autoCompleter = new Firebug.AutoCompleter(null,
                bind(this.getAutoCompleteRange, this), bind(this.getAutoCompleteList, this),
                true, false);
        }

        return this.autoCompleter;
    },

    completeValue: function(amt, offerOnly)
    {
        if (this.getAutoCompleter().complete(currentPanel.context, this.input, true, amt < 0, offerOnly))
            Firebug.Editor.update(true);
        else
            this.incrementValue(amt);
    },

    incrementValue: function(amt)
    {
        var value = this.input.value;
        var start = this.input.selectionStart, end = this.input.selectionEnd;

        var range = this.getAutoCompleteRange(value, start);
        if (!range || range.type != "int")
            range = {start: 0, end: value.length-1};

        var expr = value.substr(range.start, range.end-range.start+1);
        preExpr = value.substr(0, range.start);
        postExpr = value.substr(range.end+1);

        // See if the value is an integer, and if so increment it
        var intValue = parseInt(expr);
        if (!!intValue || intValue == 0)
        {
            var m = /\d+/.exec(expr);
            var digitPost = expr.substr(m.index+m[0].length);

            var completion = intValue-amt;
            this.input.value = preExpr + completion + digitPost + postExpr;
            this.input.setSelectionRange(start, end);

            Firebug.Editor.update(true);

            return true;
        }
        else
            return false;
    },

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *

    onKeyPress: function(event)
    {
        if (event.keyCode == 27 && !this.completeAsYouType)
        {
            var reverted = this.getAutoCompleter().revert(this.input);
            if (reverted)
                cancelEvent(event);
        }
        else if (event.charCode && this.advanceToNext(this.target, event.charCode))
        {
            Firebug.Editor.tabNextEditor();
            cancelEvent(event);
        }
        else if (this.numeric && event.charCode && (event.charCode < 48 || event.charCode > 57) && event.charCode != 45 && event.charCode != 46)
        {
            FBL.cancelEvent(event);
        }
        else
        {
            // If the user backspaces, don't autocomplete after the upcoming input event
            this.ignoreNextInput = event.keyCode == 8;
        }
    },

    onOverflow: function()
    {
        this.updateLayout(false, false, 3);
    },

    onInput: function()
    {
        if (this.ignoreNextInput)
        {
            this.ignoreNextInput = false;
            this.getAutoCompleter().reset();
        }
        else if (this.completeAsYouType)
            this.getAutoCompleter().complete(currentPanel.context, this.input, false);
        else
            this.getAutoCompleter().reset();

        Firebug.Editor.update();
    },

    onContextMenu: function(event)
    {
        cancelEvent(event);

        var popup = $("fbInlineEditorPopup");
        FBL.eraseNode(popup);

        var target = event.target;
        var menu = this.getContextMenuItems(target);
        if (menu)
        {
            for (var i = 0; i < menu.length; ++i)
                FBL.createMenuItem(popup, menu[i]);
        }

        if (!popup.firstChild)
            return false;

        popup.openPopupAtScreen(event.screenX, event.screenY, true);
        return true;
    },

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *

    updateLayout: function(initial, forceAll, extraWidth)
    {
        if (this.fixedWidth)
        {
            this.box.style.left = (this.targetOffset.x) + "px";
            this.box.style.top = (this.targetOffset.y) + "px";

            var w = this.target.offsetWidth;
            var h = this.target.offsetHeight;
            this.input.style.width = w + "px";
            this.input.style.height = (h-3) + "px";
        }
        else
        {
            if (initial || forceAll)
            {
                this.box.style.left = this.targetOffset.x + "px";
                this.box.style.top = this.targetOffset.y + "px";
            }

            var approxTextWidth = this.textSize.width;
            var maxWidth = (currentPanel.panelNode.scrollWidth - this.targetOffset.x)
                - this.outerMargin;

            var wrapped = initial
                ? this.noWrap && this.targetSize.height > this.textSize.height+3
                : this.noWrap && approxTextWidth > maxWidth;

            if (wrapped)
            {
                var style = this.target.ownerDocument.defaultView.getComputedStyle(this.target, "");
                targetMargin = parseInt(style.marginLeft) + parseInt(style.marginRight);

                // Make the width fit the remaining x-space from the offset to the far right
                approxTextWidth = maxWidth - targetMargin;

                this.input.style.width = "100%";
                this.box.style.width = approxTextWidth + "px";
            }
            else
            {
                // Make the input one character wider than the text value so that
                // typing does not ever cause the textbox to scroll
                var charWidth = this.measureInputText('m').width;

                // Sometimes we need to make the editor a little wider, specifically when
                // an overflow happens, otherwise it will scroll off some text on the left
                if (extraWidth)
                    charWidth *= extraWidth;

                var inputWidth = approxTextWidth + charWidth;

                if (initial)
                    this.box.style.width = "auto";
                else
                {
                    var xDiff = this.box.scrollWidth - this.input.offsetWidth;
                    this.box.style.width = (inputWidth + xDiff) + "px";
                }

                this.input.style.width = inputWidth + "px";
            }

            this.expander.style.width = approxTextWidth + "px";
            this.expander.style.height = (this.textSize.height-3) + "px";
        }

        if (forceAll)
            scrollIntoCenterView(this.box, null, true);
    }
});

// ************************************************************************************************
// Autocompletion

Firebug.AutoCompleter = function(getExprOffset, getRange, evaluator, selectMode, caseSensitive, noCompleteOnBlank)
{
    var candidates = null;
    var originalValue = null;
    var originalOffset = -1;
    var lastExpr = null;
    var lastOffset = -1;
    var exprOffset = 0;
    var lastIndex = -2;  // adding 1 will still be less then zero
    var preParsed = null;
    var preExpr = null;
    var postExpr = null;
    var completionPopup = $("fbCommandLineCompletionList");
    var commandCompletionLineLimit = 40;
    var reJavascriptChar = /[a-zA-Z0-9$_]/;

    this.revert = function(textBox)
    {
        if (originalOffset != -1)
        {
            textBox.value = originalValue;
            textBox.setSelectionRange(originalOffset, originalOffset);

            this.reset();
            return true;
        }
        else
        {
            this.reset();
            return false;
        }
    };

    this.reset = function()
    {
        candidates = null;
        originalValue = null;
        originalOffset = -1;
        lastExpr = null;
        lastOffset = 0;
        exprOffset = 0;
        lastIndex = -2;
    };

    this.complete = function(context, textBox, cycle, reverse, offerOnly, showGlobal)
    {
        var value = textBox.value;
        if (!value && noCompleteOnBlank)
            return false;

        if (!this.getCompletionText(textBox))
            this.reset();

        var offset = textBox.selectionStart;
        if (!offset)
            offset = value.length;

        var line = this.pickCandidates(value, offset, context, cycle, reverse, showGlobal);

        if (typeof(line) === "object")
            this.showCandidates(textBox, line, offerOnly);

        return line;
    };

    this.pickCandidates = function(value, offset, context, cycle, reverse, showGlobal)
    {
        if (!selectMode && originalOffset != -1)
            offset = originalOffset;

        if (!candidates || !cycle || offset != lastOffset)
        {
            originalOffset = offset;
            originalValue = value;

            // Find the part of the string that will be parsed
            var parseStart = getExprOffset ? getExprOffset(value, offset, context) : 0;
            preParsed = value.substr(0, parseStart);
            var parsed = value.substr(parseStart);

            // Find the part of the string that is being completed
            var range = getRange ? getRange(parsed, offset-parseStart, context) : null;
            if (!range)
                    range = {start: 0, end: parsed.length-1 };

            var expr = parsed.substr(range.start, range.end-range.start+1);
            preExpr = parsed.substr(0, range.start);
            postExpr = parsed.substr(range.end+1);
            exprOffset = parseStart + range.start;

            if (!cycle)
            {
                if (!expr)
                {
                    this.hide();
                    return false;
                }
                else if (lastExpr && lastExpr.indexOf(expr) != 0)
                {
                    candidates = null;
                }
                else if (lastExpr && lastExpr.length >= expr.length)
                {
                    candidates = null;
                    lastExpr = expr;
                    this.hide();
                    return false;
                }
            }

            lastExpr = expr;
            lastOffset = offset;

            var searchExpr;

            // Check if the cursor is at the very right edge of the expression, or
            // somewhere in the middle of it
            if (expr && offset != parseStart+range.end+1)
            {
                if (cycle)
                {
                    // We are in the middle of the expression, but we can
                    // complete by cycling to the next item in the values
                    // list after the expression
                    offset = range.start;
                    searchExpr = expr;
                    expr = "";
                }
                else
                {
                    // We can't complete unless we are at the ridge edge
                    this.hide();
                    return false;
                }
            }

            if (!showGlobal && !preExpr && !expr && !postExpr)
            {
                // Don't complete globals unless we are forced to do so.
                this.hide();
                return false;
            }

            var values = evaluator(preExpr, expr, postExpr, context);
            if (!values)
            {
                this.hide();
                return false;
            }

            if (expr)
            {
                // Filter the list of values to those which begin with expr. We
                // will then go on to complete the first value in the resulting list
                candidates = [];

                if (caseSensitive)
                {
                    for (var i = 0; i < values.length; ++i)
                    {
                        var name = values[i];
                        if (name.indexOf && name.indexOf(expr) == 0)
                            candidates.push(name);
                    }
                }
                else
                {
                    var lowerExpr = caseSensitive ? expr : expr.toLowerCase();
                    for (var i = 0; i < values.length; ++i)
                    {
                        var name = values[i];
                        if (name.indexOf && name.toLowerCase().indexOf(lowerExpr) == 0)
                            candidates.push(name);
                    }
                }
            }
            else if (searchExpr)
            {
                var searchIndex = -1;

                // Find the first instance of searchExpr in the values list. We
                // will then complete the string that is found
                if (caseSensitive)
                {
                    searchIndex = values.indexOf(expr);
                }
                else
                {
                    var lowerExpr = searchExpr.toLowerCase();
                    for (var i = 0; i < values.length; ++i)
                    {
                        var name = values[i];
                        if (name && name.toLowerCase().indexOf(lowerExpr) == 0)
                        {
                            searchIndex = i;
                            break;
                        }
                    }
                }

                // Nothing found, so there's nothing to complete to
                if (searchIndex == -1)
                    return this.reset();

                expr = searchExpr;
                candidates = cloneArray(values);
                lastIndex = searchIndex;
            }
            else
            {
                expr = "";
                candidates = [];
                for (var i = 0; i < values.length; ++i)
                {
                    if (values[i].substr)
                        candidates.push(values[i]);
                }
                lastIndex = -2;
            }
        }

        if (cycle)
        {
            expr = lastExpr;
            lastIndex += reverse ? -1 : 1;
        }

        if (!candidates.length)
            return this.hide();

        if (candidates.length === 1)
            lastIndex = 0;
        else if (lastIndex >= candidates.length || lastIndex < 0)
            lastIndex = this.pickDefaultCandidate();

        var completion = candidates[lastIndex];
        var preCompletion = expr.substr(0, offset-exprOffset);
        var postCompletion = completion.substr(offset-exprOffset);

        var line = preParsed + preExpr + preCompletion + postCompletion + postExpr;
        var offsetEnd = preParsed.length + preExpr.length + completion.length;

        var result = {value: line, index: lastIndex, userTyped: offset-exprOffset, completionStart: offset, completionEnd: offsetEnd};
        return result;
    };

    this.pickDefaultCandidate = function()
    {
        // The shortest candidate is default value
        var pick = 0;
        for (var i = 1; i < candidates.length; i++)
        {
            if (candidates[i].length < candidates[pick].length)
                pick = i;
        }
        return pick;
    };
    
    this.showCandidates = function(textBox, line, offerOnly)
    {
        textBox.value = line.value;
        var offsetStart = line.completionStart;
        var offsetEnd = line.completionEnd;

        if (selectMode)
            textBox.setSelectionRange(offsetStart, offsetEnd);
        else
            textBox.setSelectionRange(offsetEnd, offsetEnd);

        if (offerOnly && candidates.length && candidates.length > 1)
        {
            this.popupCandidates(candidates, line, textBox);
            return false;
        }
        else
        {
            this.hide();
        }
        return true;
    };

    this.popupCandidates = function(candidates, line, textBox)
    {
        FBL.eraseNode(completionPopup);

        var vbox = completionPopup.ownerDocument.createElement("vbox");
        completionPopup.appendChild(vbox);
        vbox.classList.add("fbCommandLineCompletions");

        var title = completionPopup.ownerDocument.createElementNS("http://www.w3.org/1999/xhtml","div");
        title.innerHTML = $STR("console.Use TAB and arrow keys");
        title.classList.add('fbPopupTitle');
        vbox.appendChild(title);

        var prefix = this.getVerifiedText(textBox);
        var pre = null;

        var showTop = 0;
        var showBottom = candidates.length;

        if(candidates.length > commandCompletionLineLimit)
        {
            var showBottom = commandCompletionLineLimit;

            if (line.index > (commandCompletionLineLimit - 3) ) // then implement manual scrolling
            {
                if (line.index > (candidates.length - commandCompletionLineLimit) ) // then just show the bottom
                {
                    var showTop = candidates.length - commandCompletionLineLimit;
                    var showBottom = candidates.length;
                }
                else
                {
                    var showTop = line.index - (commandCompletionLineLimit - 3);
                    var showBottom = line.index + 3;
                }
            }
            // else we are in the top part of the list
        }

        for (var i = showTop; i < showBottom; i++)
        {
            var hbox = completionPopup.ownerDocument.createElementNS("http://www.w3.org/1999/xhtml","div");
            pre = completionPopup.ownerDocument.createElementNS("http://www.w3.org/1999/xhtml","span");
            pre.innerHTML = prefix;
            var post = completionPopup.ownerDocument.createElementNS("http://www.w3.org/1999/xhtml","span");
            var completion = candidates[i].substr(line.userTyped);
            post.innerHTML = completion;
            if (i === line.index)
                post.setAttribute('selected', 'true');

            hbox.appendChild(pre);
            hbox.appendChild(post);
            vbox.appendChild(hbox);
            pre.classList.add("userTypedText");
            post.classList.add("completionText");
        }

        completionPopup.currentTextBox = textBox;
        var cmdLine = $("fbCommandLine");  // should use something relative to textbox
        var anchor = textBox;
        this.linuxFocusHack = textBox;
        completionPopup.openPopup(anchor, "before_start", 0, 0, false, false);

        return;
    };

    this.hide = function()
    {
        delete completionPopup.currentTextBox;

        if (completionPopup.state == "closed")
            return false;

        completionPopup.hidePopup();
        return true;
    };

    this.clear = function()
    {
        var textBox = completionPopup.currentTextBox;
        if (textBox)
        {
            textBox.value = this.getVerifiedText(textBox);
            this.hide();
        }
        this.reset();
    };

    this.getVerifiedText = function(textBox)
    {
        return textBox.value.substr(0, textBox.selectionStart)+textBox.value.substr(textBox.selectionEnd);
    };

    this.getCompletionText = function(textBox)
    {
        return textBox.value.substr(textBox.selectionStart, textBox.selectionEnd);
    };

    this.handledKeyUp = function(event, context, textBox)
    {
        if (!this.getCompletionText(textBox)) // then the completion was accepted
        {
            this.hide();
            this.reset();
        }
    };

    this.handledKeyDown = function(event, context, textBox)
    {
        if (event.altKey || event.metaKey)
            return false;

        if (event.ctrlKey && event.keyCode === 17) // Control space forces completion incl globals
        {
            this.complete(context, textBox, true, false, true, true);
        }
        else if (event.keyCode === 8) // backspace
        {
            if (textBox.selectionStart && textBox.seletionStart !== textBox.selectionEnd)
                textBox.selectionStart = textBox.selectionStart - 1;
        }
        else if (event.keyCode === 9) // TAB, cycle
        {
            if (isShift(event))
                this.complete(context, textBox, true, true, true);
            else
                this.complete(context, textBox, true, false, true);

            cancelEvent(event);
        }
        else if (event.keyCode === 13 || event.keyCode === 14)  // RETURN , ENTER
        {
            this.acceptCompletionInTextBox(textBox);
        }
        else if (event.keyCode == 27) // ESC, close the completer
        {
            // Stop event bubbling if it was used to close the popup.
            if (this.hide())
                cancelEvent(event);
        }
        else if (event.keyCode === 38) // UP arrow
        {
            if (textBox.selectionStart && textBox.seletionStart !== textBox.selectionEnd)
            {
                this.complete(context, textBox, true, true, true);
                cancelEvent(event);
                return true;
            }
        }
        else if (event.keyCode === 40) // DOWN arrow, cycle down
        {
            if (textBox.selectionStart && textBox.seletionStart !== textBox.selectionEnd)
            {
                this.complete(context, textBox, true, false, true);
                cancelEvent(event);
                return true;
            }
            // else the arrow will fall through to command history
        }
    },

    this.handledKeyPress = function(event, context, textBox)
    {
        var char = String.fromCharCode(event.charCode);
        switch (char)
        {
            case '.':
            case '(':
            case ')':
                this.acceptCompletionInTextBox(textBox);
                break;
            default:
                break;
        }
    };

    this.setCompletionOnEvent = function(event)
    {
        if (completionPopup.currentTextBox)
        {
            var selected = event.target;
            while (selected && (selected.localName !== "div") )
                selected = selected.parentNode;

            if (selected)
            {
                var completion = selected.getElementsByClassName('completionText')[0].textContent;
                var textBox = completionPopup.currentTextBox;
                var start = textBox.selectionStart;
                var end = start + completion.length;
                textBox.value = textBox.value.substr(0, textBox.selectionStart) + completion;
                textBox.setSelectionRange(start, end);
            }
        }
    };

    this.acceptCompletionInTextBox = function(textBox)
    {
        textBox.setSelectionRange(textBox.selectionEnd, textBox.selectionEnd);  // accept completion by deselect
        this.hide();
    };

    this.acceptCompletion = function(event)
    {
        if (completionPopup.currentTextBox)
            this.acceptCompletionInTextBox(completionPopup.currentTextBox);
    };

    this.acceptCompletion = bind(this.acceptCompletion, this);

    this.focusHack = function(event)
    {
        if (this.linuxFocusHack)
            this.linuxFocusHack.focus();
        delete this.linuxFocusHack;
    };

    this.onPopupShown = bind(this.onPopupShown, this);

    completionPopup.addEventListener("mouseover", this.setCompletionOnEvent, true);
    completionPopup.addEventListener("click", this.acceptCompletion, true);
    completionPopup.addEventListener("focus", this.focusHack, true);
};

// ************************************************************************************************
// Local Helpers

function getDefaultEditor(panel)
{
    if (!defaultEditor)
    {
        var doc = panel.document;
        defaultEditor = new Firebug.InlineEditor(doc);
    }

    return defaultEditor;
}

/**
 * An outsider is the first element matching the stepper element that
 * is not an child of group. Elements tagged with insertBefore or insertAfter
 * classes are also excluded from these results unless they are the sibling
 * of group, relative to group's parent editGroup. This allows for the proper insertion
 * rows when groups are nested.
 */
function getOutsider(element, group, stepper)
{
    var parentGroup = getAncestorByClass(group.parentNode, "editGroup");
    var next;
    do
    {
        next = stepper(next || element);
    }
    while (isAncestor(next, group) || isGroupInsert(next, parentGroup));

    return next;
}

function isGroupInsert(next, group)
{
    return (!group || isAncestor(next, group))
        && (hasClass(next, "insertBefore") || hasClass(next, "insertAfter"));
}

function getNextOutsider(element, group)
{
    return getOutsider(element, group, bind(getNextByClass, FBL, "editable"));
}

function getPreviousOutsider(element, group)
{
    return getOutsider(element, group, bind(getPreviousByClass, FBL, "editable"));
}

function getInlineParent(element)
{
    var lastInline = element;
    for (; element; element = element.parentNode)
    {
        var s = element.ownerDocument.defaultView.getComputedStyle(element, "");
        if (s.display != "inline")
            return lastInline;
        else
            lastInline = element;
    }
    return null;
}

function insertTab()
{
    insertTextIntoElement(currentEditor.input, Firebug.Editor.tabCharacter);
}

// ************************************************************************************************

Firebug.registerModule(Firebug.Editor);

// ************************************************************************************************

}});
