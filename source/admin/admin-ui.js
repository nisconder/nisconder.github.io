(function () {
  'use strict';

  window.__ADMIN_UI_V7__ = true;

  var loading = document.getElementById('admin-loading');
  var decorationFrame = 0;
  var preferredViewMode = null;
  var actionRow = null;
  var actionRowObserver = null;
  var adminHomePath = '/admin/';

  var cleanText = function (value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  };

  var cleanLabel = function (value) {
    return cleanText(value)
      .replace(/[\s\u00a0]*[\(\uff08]\u53ef\u9009[\)\uff09]/g, '')
      .replace(/\s*\*$/, '');
  };

  var lowestCommonAncestor = function (nodes) {
    var elements = nodes.filter(Boolean);
    if (!elements.length) return null;
    if (elements.length === 1) return elements[0].parentElement;
    var candidate = elements[0];
    while (candidate && candidate !== document.body) {
      if (elements.every(function (node) { return candidate.contains(node); })) return candidate;
      candidate = candidate.parentElement;
    }
    return null;
  };

  var elementDepth = function (element) {
    var depth = 0;
    while (element) {
      depth += 1;
      element = element.parentElement;
    }
    return depth;
  };

  var directChildWithin = function (ancestor, node) {
    var child = node;
    while (child && child.parentElement && child.parentElement !== ancestor) child = child.parentElement;
    return child && child.parentElement === ancestor ? child : null;
  };

  var findExactText = function (root, selector, text) {
    return Array.prototype.slice.call(root.querySelectorAll(selector)).filter(function (element) {
      return cleanLabel(element.textContent) === text;
    });
  };

  var findSmallestTextMatch = function (root, selector, pattern) {
    return Array.prototype.slice.call(root.querySelectorAll(selector)).filter(function (element) {
      var text = cleanText(element.textContent);
      if (!pattern.test(text)) return false;
      return !Array.prototype.slice.call(element.children).some(function (child) {
        return pattern.test(cleanText(child.textContent));
      });
    }).sort(function (left, right) {
      return elementDepth(right) - elementDepth(left);
    })[0] || null;
  };

  var accessibleName = function (element) {
    return cleanText(
      element.getAttribute('aria-label') ||
      element.getAttribute('title') ||
      element.textContent
    );
  };

  var findFieldWrapper = function (label) {
    // Prefer the field's label/control relationship over generated class names;
    // custom checkbox labels inside the widget are not separate fields.
    var fieldId = label.getAttribute('for');
    var fieldControl = fieldId && document.getElementById(fieldId);
    if (fieldControl) {
      var common = lowestCommonAncestor([label, fieldControl]);
      if (common && common.id !== 'nc-root') return common;
    }
    var wrapper = label.closest('[class*="ControlContainer"]');
    if (wrapper) return wrapper;

    var candidate = label.parentElement;
    while (candidate && candidate.id !== 'nc-root') {
      var labels = candidate.querySelectorAll('label, [class*="FieldLabel"]');
      var hasControl = candidate.querySelector(
        'input, textarea, select, [contenteditable="true"], .admin-pin-control, .admin-tag-control, .admin-category-control'
      );
      if (hasControl && labels.length <= 1) return candidate;
      candidate = candidate.parentElement;
    }
    return label.parentElement;
  };

  var decorateNavigation = function (root, route) {
    var header = root.querySelector('header');
    if (!header) return;
    header.dataset.adminShell = 'header';
    var logo = header.querySelector('[class*="AppHeaderLogo"]');
    if (logo && !logo.querySelector('a')) {
      var home = document.createElement('a');
      home.href = adminHomePath;
      home.className = 'admin-logo-link';
      home.setAttribute('aria-label', '返回管理首页');
      home.title = '管理首页';
      logo.appendChild(home);
    }
    var content = header.querySelector('nav a[href="#/"]');
    var media = header.querySelector('nav button');
    if (content) {
      content.dataset.adminNav = 'top';
      content.dataset.adminActive = String(route.indexOf('#/collections/') === 0 || route === '#');
    }
    if (media) media.dataset.adminNav = 'top';
  };

  var decorateActions = function (root) {
    root.querySelectorAll('a[href]').forEach(function (link) {
      var href = link.getAttribute('href') || '';
      if (/\/collections\/(posts|series)\/new$/.test(href)) {
        link.dataset.adminAction = 'new-post';
        link.setAttribute('aria-label', href.indexOf('/series/') !== -1 ? '新建合集' : '新建文章');
      }
      if (/\/collections\/(posts|series)\/entries\//.test(href)) link.dataset.adminEntry = 'post';
    });

    root.querySelectorAll('button, a, [role="button"]').forEach(function (control) {
      var label = accessibleName(control);
      if (label.indexOf('\u5feb\u901f\u65b0\u5efa') !== -1) control.dataset.adminAction = 'quick-create';
      if (/^(\u53d1\u5e03|\u5df2\u53d1\u5e03|\u6b63\u5728\u53d1\u5e03|\u53d1\u5e03\u4e2d|\u53d6\u6d88\u53d1\u5e03)/.test(label) || /^(publish|published|publishing|unpublishing)\b/i.test(label)) {
        control.dataset.adminAction = 'publish';
      }
      if (label.indexOf('\u6392\u5e8f') === 0 || label.indexOf('\u7b5b\u9009') === 0) control.dataset.adminAction = 'list-control';
      if (label === '\u73b0\u5728') control.dataset.adminAction = 'set-current-date';
      if (label === '\u6e05\u9664') control.dataset.adminAction = 'clear-date';
    });

    var search = root.querySelector('aside input[placeholder]');
    if (search) {
      search.setAttribute('aria-label', '搜索后台内容');
    }
  };

  var decorateViewControls = function (toolbar) {
    if (!toolbar) return;

    var candidates = Array.prototype.slice.call(toolbar.querySelectorAll('button, [role="button"]')).filter(function (control) {
      return !control.closest('[data-admin-action="list-control"]') &&
        Boolean(control.querySelector('svg'));
    });
    var listControl = null;
    var gridControl = null;

    candidates.forEach(function (control) {
      var label = accessibleName(control).toLowerCase();
      if (!listControl && /(list|\u5217\u8868)/.test(label)) listControl = control;
      if (!gridControl && /(grid|\u7f51\u683c)/.test(label)) gridControl = control;
    });

    var iconOnlyControls = candidates.filter(function (control) {
      return !cleanText(control.textContent);
    });
    if ((!listControl || !gridControl) && iconOnlyControls.length >= 2) {
      listControl = listControl || iconOnlyControls[iconOnlyControls.length - 2];
      gridControl = gridControl || iconOnlyControls[iconOnlyControls.length - 1];
    }
    if (!listControl || !gridControl || listControl === gridControl) return;

    var controls = [listControl, gridControl];
    var inferredMode = null;
    controls.forEach(function (control, index) {
      var mode = index === 0 ? 'list' : 'grid';
      var stateText = [
        control.getAttribute('aria-pressed'),
        control.getAttribute('aria-selected'),
        control.getAttribute('data-state'),
        control.className
      ].join(' ').toLowerCase();
      if (/(^|\s)(true|active|selected|on)(\s|$)/.test(stateText)) inferredMode = mode;
    });

    var selectedMode = preferredViewMode || inferredMode || 'list';
    controls.forEach(function (control, index) {
      var mode = index === 0 ? 'list' : 'grid';
      control.dataset.adminAction = 'view-mode';
      control.dataset.adminView = mode;
      control.dataset.adminActive = String(selectedMode === mode);
      control.setAttribute('aria-label', mode === 'list' ? '\u5217\u8868\u89c6\u56fe' : '\u7f51\u683c\u89c6\u56fe');
      control.setAttribute('aria-pressed', String(selectedMode === mode));

      if (!control.__adminViewModeBound) {
        control.__adminViewModeBound = true;
        control.addEventListener('click', function () {
          preferredViewMode = control.dataset.adminView;
          scheduleDecoration();
        });
      }
    });

    var group = lowestCommonAncestor(controls);
    var groupControls = group ? Array.prototype.slice.call(group.querySelectorAll('button, [role="button"]')) : [];
    var hasDedicatedGroup = Boolean(
      group &&
      group !== toolbar &&
      group.id !== 'nc-root' &&
      groupControls.length === 2 &&
      groupControls.every(function (control) { return controls.indexOf(control) !== -1; })
    );

    controls.forEach(function (control) {
      control.dataset.adminViewGroup = hasDedicatedGroup ? 'wrapped' : 'inline';
    });

    if (hasDedicatedGroup) {
      group.dataset.adminSection = 'view-switch';
      group.setAttribute('role', 'group');
      group.setAttribute('aria-label', '\u89c6\u56fe\u6a21\u5f0f');
    } else {
      var listBranch = directChildWithin(toolbar, listControl);
      var gridBranch = directChildWithin(toolbar, gridControl);
      if (listBranch && gridBranch && listBranch !== gridBranch && listBranch.nextElementSibling === gridBranch) {
        listBranch.dataset.adminViewBranch = 'list';
        gridBranch.dataset.adminViewBranch = 'grid';
      }
    }
    toolbar.dataset.adminViewMode = selectedMode;
  };

  var decorateCollection = function (root) {
    var collectionLabel = root.dataset.adminCollection === 'series' ? '合集' : '文章';
    var entryLinks = Array.prototype.slice.call(root.querySelectorAll('[data-admin-entry="post"]'));
    var newPost = root.querySelector('[data-admin-action="new-post"]');
    var heading = findExactText(root, 'h1, h2, h3', collectionLabel).filter(function (element) {
      return !element.closest('aside');
    })[0] || root.querySelector('main h1, main h2');
    var controls = Array.prototype.slice.call(root.querySelectorAll('[data-admin-action="list-control"]'));
    var toolbar = root.querySelector('[class*="CollectionControlsContainer"]') || (controls.length > 1 && lowestCommonAncestor(controls));
    var entryList = lowestCommonAncestor(entryLinks);
    var collectionHeader = lowestCommonAncestor([heading, newPost]);

    if (heading) heading.dataset.adminCount = entryLinks.length
      ? '已显示 ' + entryLinks.length + (collectionLabel === '合集' ? ' 个' : ' 篇') : '';
    if (collectionHeader) collectionHeader.dataset.adminSection = 'collection-header';
    if (toolbar) {
      toolbar.dataset.adminSection = 'list-toolbar';
      decorateViewControls(toolbar);
    }
    if (entryList) {
      entryList.dataset.adminSection = 'entry-list';
      entryLinks.forEach(function (link) {
        var shell = directChildWithin(entryList, link);
        if (shell && shell !== link) shell.dataset.adminEntryShell = 'true';
      });
    }

    var workspace = root.querySelector('main[class*="CollectionMain"]');
    var sidebar = root.querySelector('aside');
    var layout = workspace && sidebar && lowestCommonAncestor([workspace, sidebar]);
    if (!layout || layout.id === 'nc-root') return;
    layout.dataset.adminLayout = 'collection';
    sidebar.dataset.adminSection = 'sidebar';
    workspace.dataset.adminWorkspace = 'collection';
    [collectionHeader, toolbar, entryList].forEach(function (section, index) {
      var slot = section && directChildWithin(workspace, section);
      if (slot) slot.dataset.adminWorkspaceSlot = ['header', 'toolbar', 'entries'][index];
    });
  };

  var decorateEditor = function (root) {
    var definitions = [
      { fields: ['title'], labels: ['\u6807\u9898'], name: 'title' },
      { fields: ['description'], labels: ['\u6458\u8981'], name: 'description' },
      { fields: ['date'], labels: ['\u6587\u7ae0\u65e5\u671f', '\u53d1\u5e03\u65f6\u95f4'], name: 'date' },
      { fields: ['draft'], labels: ['\u4f5c\u4e3a\u8349\u7a3f'], name: 'draft' },
      { fields: ['sticky'], labels: ['\u9996\u9875\u4f4d\u7f6e', '\u9996\u9875\u6392\u5e8f'], name: 'position' },
      { fields: ['categories'], labels: ['\u5206\u7c7b'], name: 'category' },
      { fields: ['tags'], labels: ['\u6807\u7b7e'], name: 'tags' },
      { fields: ['body'], labels: ['\u6b63\u6587'], name: 'body' }
    ];
    var fields = [];

    definitions.forEach(function (definition) {
      var label = null;
      definition.fields.some(function (fieldName) {
        label = Array.prototype.slice.call(root.querySelectorAll('label[for], [class*="FieldLabel"][for]')).filter(function (candidate) {
          var target = candidate.getAttribute('for') || '';
          return target === fieldName || target.indexOf(fieldName + '-field-') === 0;
        })[0] || null;
        return Boolean(label);
      });
      definition.labels.some(function (text) {
        if (label) return true;
        label = findExactText(root, 'label, [class*="FieldLabel"]', text)[0] || null;
        return Boolean(label);
      });
      if (!label) return;
      var wrapper = findFieldWrapper(label);
      if (!wrapper) return;
      wrapper.dataset.adminField = definition.name;
      label.dataset.adminFieldLabel = 'true';
      var topbar = directChildWithin(wrapper, label);
      if (topbar && topbar !== label) topbar.dataset.adminFieldTopbar = 'true';
      Array.prototype.slice.call(wrapper.children).forEach(function (child) {
        if (child.tagName === 'P' && child !== topbar) child.dataset.adminFieldHint = 'true';
      });
      fields.push({ name: definition.name, wrapper: wrapper });
    });

    var fieldNames = fields.map(function (field) { return field.name; });
    if (fields.length < 4 || fieldNames.indexOf('title') === -1 || fieldNames.indexOf('body') === -1) return;
    var form = lowestCommonAncestor(fields.map(function (field) { return field.wrapper; }));
    if (!form || form.id === 'nc-root') return;

    var usedSlots = [];
    fields.forEach(function (field) {
      var slot = directChildWithin(form, field.wrapper);
      if (!slot || usedSlots.indexOf(slot) !== -1) return;
      slot.dataset.adminFieldSlot = field.name;
      usedSlots.push(slot);
    });
    if (usedSlots.length < 4) return;
    form.dataset.adminForm = 'post';

    var dateField = root.querySelector('[data-admin-field="date"]');
    if (dateField) {
      var dateInput = dateField.querySelector('input');
      var dateNow = dateField.querySelector('[data-testid="now-button"]');
      var dateClear = dateField.querySelector('[data-testid="clear-button"]');
      if (dateNow) dateNow.dataset.adminAction = 'set-current-date';
      if (dateClear) dateClear.dataset.adminAction = 'clear-date';
      var dateRow = lowestCommonAncestor([dateInput, dateNow, dateClear]);
      if (dateRow && dateRow !== dateField) {
        dateRow.dataset.adminDateRow = 'true';
        var dateInputSlot = directChildWithin(dateRow, dateInput);
        if (dateInputSlot) dateInputSlot.dataset.adminDateInput = 'true';
        var dateActionSlot = directChildWithin(dateRow, dateNow || dateClear);
        if (dateActionSlot && dateActionSlot !== dateInputSlot) dateActionSlot.dataset.adminDateActions = 'true';
      }
    }

    var bodyField = root.querySelector('[data-admin-field="body"]');
    if (bodyField) {
      // ToolbarDropdownWrapper contains a role=button around a real button.
      // Counting both picked the H dropdown as the *entire* toolbar.
      bodyField.querySelectorAll('[data-admin-section="editor-toolbar"]').forEach(function (element) {
        delete element.dataset.adminSection;
      });
      var toolbar = bodyField.querySelector('[class*="ToolbarContainer"]');
      if (!toolbar) {
        toolbar = Array.prototype.slice.call(bodyField.querySelectorAll('[role="toolbar"]')).filter(function (candidate) {
          return candidate.querySelectorAll('button[title]').length >= 2;
        })[0] || null;
      }
      if (toolbar) {
        toolbar.dataset.adminSection = 'editor-toolbar';
        Array.prototype.slice.call(toolbar.children).forEach(function (group) {
          if (group.querySelector('button[title]')) group.dataset.adminToolbarGroup = 'true';
        });
      }
    }

    var editorBackLink = null;
    var editorShell = null;
    var editorShellDepth = -1;
    Array.prototype.slice.call(root.querySelectorAll('a[href]')).forEach(function (link) {
      var href = link.getAttribute('href') || '';
      if (!/^#\/collections\/posts\/?$/.test(href)) return;
      var candidateShell = lowestCommonAncestor([link, form]);
      if (!candidateShell || candidateShell.id === 'nc-root') return;
      var candidateDepth = elementDepth(candidateShell);
      if (candidateDepth <= editorShellDepth) return;
      editorBackLink = link;
      editorShell = candidateShell;
      editorShellDepth = candidateDepth;
    });

    var editorHeader = editorShell && editorBackLink
      ? directChildWithin(editorShell, editorBackLink)
      : null;
    if (editorHeader) editorHeader.dataset.adminShell = 'editor-toolbar';
    if (editorBackLink) {
      editorBackLink.dataset.adminAction = 'editor-back';
      editorBackLink.setAttribute('aria-label', '\u8fd4\u56de\u6587\u7ae0\u5217\u8868');
      editorBackLink.setAttribute('title', '\u8fd4\u56de\u6587\u7ae0\u5217\u8868');

      if (editorBackLink.children.length > 1) {
        editorBackLink.lastElementChild.dataset.adminSection = 'editor-back-copy';
      }
    }

    if (editorHeader) {
      var context = findSmallestTextMatch(editorHeader, 'div, span, p', /\u6b63\u5728\u96c6\u5408.*\u4e2d\u7f16\u5199/);
      var status = findSmallestTextMatch(editorHeader, 'div, span, p', /(\u672a\u4fdd\u5b58|\u4fee\u6539\u5df2\u4fdd\u5b58|\u5df2\u4fdd\u5b58)/);
      if (context) context.dataset.adminEditorContext = 'true';
      if (status) status.dataset.adminEditorStatus = /\u672a\u4fdd\u5b58/.test(cleanText(status.textContent)) ? 'unsaved' : 'saved';
    }

    var publishAction = editorHeader && Array.prototype.slice.call(editorHeader.querySelectorAll('button, [role="button"]')).filter(function (control) {
      var label = accessibleName(control);
      return /^(\u53d1\u5e03|\u5df2\u53d1\u5e03|\u6b63\u5728\u53d1\u5e03|\u53d1\u5e03\u4e2d|\u53d6\u6d88\u53d1\u5e03)/.test(label) || /^(publish|published|publishing|unpublishing)\b/i.test(label);
    })[0] || null;
    if (publishAction) {
      publishAction.dataset.adminAction = 'publish';
      var publishSource = publishAction.parentElement;
      var publishWrapper = publishSource && publishSource.children.length === 1 && publishSource.firstElementChild === publishAction
        ? publishSource.parentElement
        : null;
      if (publishWrapper && publishWrapper !== editorHeader && editorHeader.contains(publishWrapper)) {
        publishWrapper.dataset.adminSection = 'publish-menu';
      }
    }

    var editorControls = Array.prototype.slice.call(root.querySelectorAll('button, [role="button"]')).filter(function (control) {
      return !(editorHeader && editorHeader.contains(control)) && !control.closest('[data-admin-field="body"]');
    });
    var previewToggle = editorControls.filter(function (control) {
      return /(\u9884\u89c8|preview)/i.test(accessibleName(control));
    })[0] || null;
    var scrollToggle = editorControls.filter(function (control) {
      return /(\u6eda\u52a8|scroll)/i.test(accessibleName(control));
    })[0] || null;
    var previewFrame = root.querySelector('iframe#preview-pane');
    var previewOpen = Boolean(previewFrame);

    root.dataset.adminPreview = previewOpen ? 'open' : 'closed';
    if (!previewOpen) {
      root.querySelectorAll('[data-admin-editor-layout]').forEach(function (element) {
        delete element.dataset.adminEditorLayout;
      });
      root.querySelectorAll('[data-admin-editor-pane]').forEach(function (element) {
        delete element.dataset.adminEditorPane;
      });
      root.querySelectorAll('[data-admin-editor-resizer]').forEach(function (element) {
        delete element.dataset.adminEditorResizer;
      });
      root.querySelectorAll('[data-admin-preview-layer]').forEach(function (element) {
        delete element.dataset.adminPreviewLayer;
      });
    }
    if (previewToggle) {
      previewToggle.dataset.adminAction = 'preview-toggle';
      previewToggle.dataset.adminActive = String(previewOpen);
      previewToggle.setAttribute('aria-label', previewOpen ? '\u5173\u95ed\u9884\u89c8\u5e76\u7ee7\u7eed\u5199\u4f5c' : '\u9884\u89c8\u6587\u7ae0');
      previewToggle.setAttribute('aria-pressed', String(previewOpen));
      previewToggle.setAttribute('title', previewOpen ? '\u5173\u95ed\u9884\u89c8\u5e76\u7ee7\u7eed\u5199\u4f5c' : '\u9884\u89c8\u6587\u7ae0');
      if (previewToggle.parentElement) previewToggle.parentElement.dataset.adminSection = 'editor-view-controls';
    }
    if (scrollToggle) scrollToggle.dataset.adminAction = 'scroll-sync';

    if (editorShell && editorShell.id !== 'nc-root') {
      editorShell.dataset.adminEditorShell = 'post';
      var editorContent = directChildWithin(editorShell, form);
      if (editorContent && editorContent !== editorHeader) editorContent.dataset.adminEditorContent = 'post';

      var layer = form.parentElement;
      while (layer && layer !== editorShell) {
        layer.dataset.adminEditorLayer = 'flow';
        layer = layer.parentElement;
      }
    }

    if (previewFrame) {
      var split = lowestCommonAncestor([form, previewFrame]);
      var formPane = split && directChildWithin(split, form);
      var previewPane = split && directChildWithin(split, previewFrame);
      if (split && split.id !== 'nc-root' && formPane && previewPane && formPane !== previewPane) {
        split.dataset.adminEditorLayout = 'split';
        formPane.dataset.adminEditorPane = 'form';
        previewPane.dataset.adminEditorPane = 'preview';
        Array.prototype.slice.call(split.children).forEach(function (child) {
          if (/(^|\s)Resizer(\s|$)/.test(child.className || '')) child.dataset.adminEditorResizer = 'true';
        });
        var previewContainer = previewFrame.parentElement;
        while (previewContainer && previewContainer !== previewPane) {
          previewContainer.dataset.adminPreviewLayer = 'flow';
          previewContainer = previewContainer.parentElement;
        }
        previewPane.dataset.adminPreviewLayer = 'flow';
      }
    }
  };

  var finishLoading = function () {
    if (!loading || !document.querySelector('#nc-root > *')) return;
    loading.classList.add('is-finished');
    window.setTimeout(function () {
      if (loading && loading.parentNode) loading.parentNode.removeChild(loading);
    }, 240);
  };

  var decorateSeriesEditor = function (root) {
    var fields = ['title', 'description', 'slug', 'draft', 'chapters'].map(function (name) {
      var label = Array.prototype.slice.call(root.querySelectorAll('label[for], [class*="FieldLabel"][for]')).find(function (candidate) {
        var target = candidate.getAttribute('for') || '';
        return target === name || target.indexOf(name + '-field-') === 0;
      });
      if (!label) return null;
      var wrapper = findFieldWrapper(label);
      if (!wrapper) return null;
      wrapper.dataset.adminSeriesField = name;
      return wrapper;
    }).filter(Boolean);
    if (fields.length !== 5) return;
    var form = lowestCommonAncestor(fields);
    if (!form || form.id === 'nc-root') return;
    form.dataset.adminForm = 'series';
    fields.forEach(function (field) {
      var slot = directChildWithin(form, field);
      if (slot) slot.dataset.adminSeriesSlot = field.dataset.adminSeriesField;
    });
    // Decap's editor shell has an 800px minimum and a fixed scroll pane.
    // Mark the real ancestors so a narrow screen can use normal document flow.
    var layer = form.parentElement;
    while (layer && layer !== root) {
      layer.dataset.adminSeriesLayer = 'flow';
      layer = layer.parentElement;
    }
    var back = root.querySelector('a[href="#/collections/series"]');
    var shell = back && lowestCommonAncestor([back, form]);
    var toolbar = shell && directChildWithin(shell, back);
    if (toolbar && !toolbar.contains(form)) toolbar.dataset.adminSeriesToolbar = 'true';
  };


  // The action row can wrap when labels, font size or viewport width change.
  // The Markdown toolbar sticks immediately below its actual border box.
  var observeActionRow = function (nextRow) {
    if (actionRow === nextRow || !window.ResizeObserver) return;
    if (actionRowObserver) {
      actionRowObserver.disconnect();
      actionRowObserver = null;
    }
    actionRow = nextRow;
    if (!actionRow) return;
    var shell = actionRow.closest('[data-admin-editor-shell="post"]');
    if (!shell) return;
    actionRowObserver = new window.ResizeObserver(function () {
      shell.style.setProperty('--admin-action-row-height', nextRow.getBoundingClientRect().height + 'px');
    });
    actionRowObserver.observe(nextRow, { box: 'border-box' });
  };

  var decorate = function () {
    decorationFrame = 0;
    var root = document.getElementById('nc-root');
    if (!root) return;

    var route = window.location.hash || '#/';
    var routePath = route.split('?')[0].replace(/\/$/, '');
    root.dataset.adminContract = 'v6';
    root.dataset.adminCollection = routePath.indexOf('#/collections/series') === 0 ? 'series' : 'posts';
    root.dataset.adminPage = /^#\/collections\/(posts|series)(?:\/search\/.*)?$/.test(routePath)
      ? 'collection'
      : (/^#\/collections\/posts\/(new|entries\/)/.test(routePath) ? 'editor'
        : (/^#\/collections\/series\/(new|entries\/)/.test(routePath) ? 'series-editor' : 'other'));

    var authButton = root.querySelector('button[class*="LoginButton"]');
    var auth = authButton && authButton.closest('section');
    if (auth && !auth.querySelector('.admin-auth-copy')) {
      auth.dataset.adminAuth = 'true';
      var copy = document.createElement('div');
      copy.className = 'admin-auth-copy';
      var brand = document.createElement('p');
      brand.textContent = 'Nisconder';
      var heading = document.createElement('h1');
      heading.textContent = '写作后台';
      copy.append(brand, heading);
      auth.insertBefore(copy, authButton);
    }

    decorateNavigation(root, routePath);
    decorateActions(root);
    if (root.dataset.adminPage === 'collection') decorateCollection(root);
    if (root.dataset.adminPage === 'editor') decorateEditor(root);
    if (root.dataset.adminPage === 'series-editor') decorateSeriesEditor(root);
    observeActionRow(root.dataset.adminPage === 'editor'
      ? root.querySelector('[data-admin-shell="editor-toolbar"] > [class*="ToolbarSectionMain"]')
      : null);
  };

  var scheduleDecoration = function () {
    if (decorationFrame) return;
    decorationFrame = window.requestAnimationFrame(decorate);
  };

  var observer = new MutationObserver(function () {
    finishLoading();
    scheduleDecoration();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  finishLoading();
  scheduleDecoration();
  window.addEventListener('hashchange', scheduleDecoration);

  window.setTimeout(function () {
    if (!loading || loading.classList.contains('is-finished')) return;
    var message = loading.querySelector('p');
    if (message) message.textContent = '\u52a0\u8f7d\u65f6\u95f4\u6709\u70b9\u4e45\uff0c\u8bf7\u68c0\u67e5\u7f51\u7edc\u540e\u5237\u65b0\u9875\u9762\u3002';
  }, 10000);
}());
