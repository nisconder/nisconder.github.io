(function () {
  'use strict';
  if (!window.CMS || !window.createClass || !window.h) return;
  var h = window.h;

  function chapters(value) {
    var entries = value && typeof value.toJS === 'function' ? value.toJS() : value;
    if (!Array.isArray(entries)) return [];
    return entries.map(function (entry) {
      return { post: entry && typeof entry.post === 'string' ? entry.post : '' };
    });
  }

  function reordered(entries, from, to) {
    var next = entries.slice();
    var moved = next.splice(from, 1)[0];
    next.splice(to, 0, moved);
    return next;
  }

  var SeriesCards = window.createClass({
    getInitialState: function () {
      return { posts: [], loading: true, error: false, query: '', adding: false, drag: null, message: '' };
    },

    componentDidMount: function () {
      this.alive = true;
      this.loadPosts();
      this.root.addEventListener('touchstart', this.onTouchStart, { passive: true });
      window.addEventListener('touchmove', this.onTouchMove, { passive: false });
      window.addEventListener('touchend', this.onTouchEnd);
      window.addEventListener('touchcancel', this.cancelDrag);
      window.addEventListener('pointermove', this.onPointerMove);
      window.addEventListener('pointerup', this.onPointerUp);
      window.addEventListener('pointercancel', this.onPointerCancel);
      window.addEventListener('keydown', this.onGlobalKeyDown);
      window.addEventListener('blur', this.cancelDrag);
    },

    componentDidUpdate: function () {
      if (this.dragging && JSON.stringify(this.readValue()) !== this.dragging.signature) this.cancelDrag();
    },

    componentWillUnmount: function () {
      this.alive = false;
      this.stopDrag();
      if (this.request) this.request.abort();
      this.root.removeEventListener('touchstart', this.onTouchStart);
      window.removeEventListener('touchmove', this.onTouchMove);
      window.removeEventListener('touchend', this.onTouchEnd);
      window.removeEventListener('touchcancel', this.cancelDrag);
      window.removeEventListener('pointermove', this.onPointerMove);
      window.removeEventListener('pointerup', this.onPointerUp);
      window.removeEventListener('pointercancel', this.onPointerCancel);
      window.removeEventListener('keydown', this.onGlobalKeyDown);
      window.removeEventListener('blur', this.cancelDrag);
    },

    readValue: function () { return chapters(this.props.value); },

    isValid: function () {
      var entries = this.readValue();
      var seen = new Set();
      for (var i = 0; i < entries.length; i += 1) {
        if (!entries[i].post.trim()) return { error: { message: '请移除未选择文章的卡片，再添加需要的文章。' } };
        if (seen.has(entries[i].post)) return { error: { message: '同一篇文章不能在合集中重复出现，请移除重复的卡片。' } };
        seen.add(entries[i].post);
      }
      return true;
    },

    loadPosts: function () {
      var self = this;
      if (this.request) this.request.abort();
      this.request = new AbortController();
      this.setState({ loading: true, error: false });
      fetch('/admin/post-options.json', { signal: this.request.signal, credentials: 'same-origin' })
        .then(function (response) {
          if (!response.ok) throw new Error('Post options unavailable');
          return response.json();
        })
        .then(function (data) {
          if (!Array.isArray(data.posts)) throw new Error('Invalid post options');
          var seen = new Set();
          var posts = data.posts.filter(function (post) {
            if (!post || typeof post.id !== 'string' || !post.id || typeof post.title !== 'string' || post.draft === true || seen.has(post.id)) return false;
            seen.add(post.id);
            return true;
          }).map(function (post) {
            return { id: post.id, title: post.title, description: typeof post.description === 'string' ? post.description : '' };
          });
          if (self.alive) self.setState({ posts: posts, loading: false, error: false });
        })
        .catch(function (error) {
          if (self.alive && error.name !== 'AbortError') self.setState({ loading: false, error: true });
        });
    },

    postInfo: function (id) {
      return this.state.posts.find(function (post) { return post.id === id; }) || {
        id: id,
        title: id || '未选择文章',
        description: this.state.loading ? '正在读取文章信息…' : '暂未匹配到已发布文章；此引用已保留，可继续调整顺序。',
        unresolved: true
      };
    },

    announce: function (message) { this.setState({ message: message }); },

    focusCard: function (id) {
      var self = this;
      window.requestAnimationFrame(function () {
        if (!self.alive || !self.root) return;
        var card = Array.prototype.find.call(self.root.querySelectorAll('[data-series-card]'), function (element) {
          return element.dataset.postId === id;
        });
        if (card) card.focus({ preventScroll: true });
      });
    },

    moveCard: function (from, to) {
      var entries = this.readValue();
      if (from < 0 || to < 0 || from >= entries.length || to >= entries.length || from === to) return;
      var id = entries[from].post;
      this.props.onChange(reordered(entries, from, to));
      this.announce(this.postInfo(id).title + '已移到第 ' + (to + 1) + ' 篇。发布后生效。');
      this.focusCard(id);
    },

    addPost: function (post) {
      var entries = this.readValue();
      if (entries.some(function (entry) { return entry.post === post.id; })) return;
      this.props.onChange(entries.concat({ post: post.id }));
      this.setState({ query: '', message: '已添加《' + post.title + '》，排在第 ' + (entries.length + 1) + ' 篇。' });
    },

    removeCard: function (index) {
      var entries = this.readValue();
      var title = this.postInfo(entries[index].post).title;
      this.props.onChange(entries.filter(function (_entry, position) { return position !== index; }));
      this.announce('已从合集中移除《' + title + '》，文章正文仍保留。');
    },

    onCardKeyDown: function (event, index) {
      if (event.target !== event.currentTarget || !event.altKey) return;
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault();
        this.moveCard(index, index + (event.key === 'ArrowUp' ? -1 : 1));
      }
    },

    candidate: function (target, x, y, pointerId) {
      if (target.closest('button, input, a, textarea, select')) return null;
      var card = target.closest('[data-series-card]');
      if (!card || !this.root.contains(card)) return null;
      return { card: card, index: Number(card.dataset.seriesIndex), x: x, y: y, pointerId: pointerId };
    },

    onPointerDown: function (event) {
      if (event.pointerType === 'touch' || event.button !== 0) return;
      this.pending = this.candidate(event.target, event.clientX, event.clientY, event.pointerId);
      if (this.pending) event.preventDefault();
    },

    onPointerMove: function (event) {
      if (event.pointerType === 'touch') return;
      if (this.pending && this.pending.pointerId === event.pointerId) {
        if (Math.hypot(event.clientX - this.pending.x, event.clientY - this.pending.y) < 6) return;
        this.beginDrag(this.pending, event.clientX, event.clientY);
      }
      if (this.dragging && this.dragging.pointerId === event.pointerId) {
        event.preventDefault();
        this.updateDrag(event.clientX, event.clientY);
      }
    },

    onPointerUp: function (event) {
      if (event.pointerType === 'touch') return;
      if (this.dragging && this.dragging.pointerId === event.pointerId) this.finishDrag();
      this.pending = null;
    },

    onPointerCancel: function (event) {
      // Touch dragging has its own non-passive TouchEvent stream. Browsers
      // may cancel the parallel pointer stream when they evaluate pan-y.
      if (event.pointerType !== 'touch') this.cancelDrag();
    },

    onTouchStart: function (event) {
      if (event.touches.length !== 1) { this.cancelDrag(); return; }
      var touch = event.touches[0];
      var candidate = this.candidate(event.target, touch.clientX, touch.clientY, 'touch');
      if (!candidate) return;
      this.pending = candidate;
      var self = this;
      this.holdTimer = window.setTimeout(function () {
        if (self.pending === candidate) self.beginDrag(candidate, candidate.x, candidate.y);
      }, 220);
    },

    onTouchMove: function (event) {
      if (event.touches.length !== 1) { this.cancelDrag(); return; }
      var touch = event.touches[0];
      if (this.dragging && this.dragging.pointerId === 'touch') {
        if (event.cancelable) event.preventDefault();
        this.updateDrag(touch.clientX, touch.clientY);
      } else if (this.pending && Math.hypot(touch.clientX - this.pending.x, touch.clientY - this.pending.y) > 8) {
        window.clearTimeout(this.holdTimer);
        this.pending = null;
      }
    },

    onTouchEnd: function () {
      if (this.dragging && this.dragging.pointerId === 'touch') this.finishDrag();
      window.clearTimeout(this.holdTimer);
      this.pending = null;
    },

    beginDrag: function (candidate, x, y) {
      var entries = this.readValue();
      if (!entries[candidate.index]) return;
      var rect = candidate.card.getBoundingClientRect();
      this.dragging = {
        index: candidate.index, target: candidate.index, entries: entries,
        signature: JSON.stringify(entries), pointerId: candidate.pointerId,
        id: entries[candidate.index].post, x: x, y: y,
        offsetX: candidate.x - rect.left, offsetY: candidate.y - rect.top,
        width: rect.width, height: rect.height
      };
      this.pending = null;
      window.clearTimeout(this.holdTimer);
      this.setState({ drag: Object.assign({}, this.dragging), message: '正在移动《' + this.postInfo(this.dragging.id).title + '》。松开即可放置，按 Esc 取消。' });
      this.scrollFrame = window.requestAnimationFrame(this.autoScroll);
    },

    updateDrag: function (x, y) {
      if (!this.dragging || !this.root) return;
      var cards = Array.prototype.slice.call(this.root.querySelectorAll('[data-series-card]'));
      var target = 0;
      cards.forEach(function (card) {
        var rect = card.getBoundingClientRect();
        if (y > rect.top + rect.height / 2) target += 1;
      });
      this.dragging.x = x;
      this.dragging.y = y;
      this.dragging.target = Math.min(target, this.dragging.entries.length - 1);
      this.setState({ drag: Object.assign({}, this.dragging) });
    },

    autoScroll: function () {
      if (!this.dragging) return;
      var y = this.dragging.y;
      var edge = 72;
      var delta = y < edge ? -Math.min(16, (edge - y) / 4) : y > window.innerHeight - edge ? Math.min(16, (y - window.innerHeight + edge) / 4) : 0;
      if (delta) {
        window.scrollBy(0, delta);
        this.updateDrag(this.dragging.x, y);
      }
      this.scrollFrame = window.requestAnimationFrame(this.autoScroll);
    },

    stopDrag: function () {
      window.clearTimeout(this.holdTimer);
      window.cancelAnimationFrame(this.scrollFrame);
      this.pending = null;
      this.dragging = null;
    },

    finishDrag: function () {
      var drag = this.dragging;
      this.stopDrag();
      this.setState({ drag: null });
      if (drag && JSON.stringify(this.readValue()) === drag.signature) this.moveCard(drag.index, drag.target);
    },

    cancelDrag: function () {
      var active = this.dragging;
      this.stopDrag();
      if (this.alive && active) this.setState({ drag: null, message: '已取消移动，阅读顺序未改变。' });
    },

    onGlobalKeyDown: function (event) {
      if (event.key === 'Escape' && (this.pending || this.dragging)) {
        event.preventDefault();
        this.cancelDrag();
      }
    },

    renderCard: function (entry, index, total, isSource) {
      var self = this;
      var post = this.postInfo(entry.post);
      return h('li', {
        key: entry.post + ':' + index, className: 'series-cards__card' + (isSource ? ' series-cards__card--source' : ''),
        'data-series-card': isSource ? undefined : '', 'data-series-source': isSource ? '' : undefined,
        'data-post-id': entry.post, 'data-series-index': index,
        tabIndex: isSource ? -1 : 0, 'aria-hidden': isSource ? true : undefined,
        'aria-label': '第 ' + (index + 1) + ' 篇：' + post.title,
        onPointerDown: this.onPointerDown,
        onKeyDown: function (event) { self.onCardKeyDown(event, index); },
        onContextMenu: function (event) { if (self.pending || self.dragging) event.preventDefault(); }
      },
      h('span', { className: 'series-cards__number', 'aria-hidden': 'true' }, String(index + 1).padStart(2, '0')),
      h('div', { className: 'series-cards__copy' },
        h('strong', { className: 'series-cards__title' }, post.title),
        post.description && h('p', { className: 'series-cards__description' }, post.description),
        h('div', { className: 'series-cards__footer' },
          h('span', { className: 'series-cards__drag-hint', 'data-series-drag': '', 'aria-hidden': 'true' }, '⠿ 拖动卡片'),
          h('div', { className: 'series-cards__actions' },
            h('button', { type: 'button', 'data-series-move': 'up', disabled: index === 0, onClick: function () { self.moveCard(index, index - 1); }, 'aria-label': '上移《' + post.title + '》', title: '上移一篇' }, '↑'),
            h('button', { type: 'button', 'data-series-move': 'down', disabled: index === total - 1, onClick: function () { self.moveCard(index, index + 1); }, 'aria-label': '下移《' + post.title + '》', title: '下移一篇' }, '↓'),
            h('button', { type: 'button', 'data-series-remove': '', onClick: function () { self.removeCard(index); }, 'aria-label': '从合集中移除《' + post.title + '》', title: '仅从合集移除，保留文章' }, '移除')
          )
        )
      ));
    },

    render: function () {
      var self = this;
      var entries = this.readValue();
      var drag = this.state.drag;
      var list = [];
      var position = 0;
      entries.forEach(function (entry, index) {
        if (drag && index === drag.index) {
          // Keep the original touch target mounted until touchend; detached
          // targets cannot bubble subsequent touchmove events to the window.
          list.push(self.renderCard(entry, index, entries.length, true));
          return;
        }
        if (drag && position === drag.target) list.push(h('li', { key: 'drop-position', className: 'series-cards__placeholder', 'data-series-placeholder': '', style: { height: drag.height }, 'aria-hidden': 'true' }, '放在这里 · 第 ' + (drag.target + 1) + ' 篇'));
        list.push(self.renderCard(entry, index, entries.length));
        position += 1;
      });
      if (drag && position === drag.target) list.push(h('li', { key: 'drop-position', className: 'series-cards__placeholder', 'data-series-placeholder': '', style: { height: drag.height }, 'aria-hidden': 'true' }, '放在这里 · 第 ' + (drag.target + 1) + ' 篇'));
      var selected = new Set(entries.map(function (entry) { return entry.post; }));
      var query = this.state.query.trim().toLowerCase();
      var available = this.state.posts.filter(function (post) {
        return !selected.has(post.id) && (!query || (post.title + ' ' + post.id).toLowerCase().indexOf(query) !== -1);
      });
      var ghost = drag && this.postInfo(drag.id);
      return h('div', { id: this.props.forID, className: 'series-cards', 'data-series-cards': '', ref: function (node) { self.root = node; } },
        h('div', { className: 'series-cards__heading' },
          h('div', null, h('strong', null, entries.length + ' 篇文章'), h('p', null, '拖动整张卡片调整顺序，手机长按后拖动。')),
          h('button', { type: 'button', className: 'series-cards__add-toggle', 'data-series-add-toggle': '', 'aria-expanded': this.state.adding, onClick: function () { self.setState({ adding: !self.state.adding }); } }, this.state.adding ? '收起添加' : '+ 添加文章')
        ),
        h('p', { className: 'series-cards__help' }, '也可用 ↑ ↓ 按钮，或选中卡片后按 Alt + ↑ / ↓。调整后点击“发布”保存。'),
        this.state.error && h('div', { className: 'series-cards__load-error', role: 'status' }, '文章信息暂时未加载，已有顺序仍可调整。', h('button', { type: 'button', onClick: this.loadPosts }, '重新加载')),
        this.state.adding && h('section', { className: 'series-cards__picker', 'aria-label': '添加已发布文章' },
          h('label', { htmlFor: this.props.forID + '-search' }, '搜索已发布文章'),
          h('input', { id: this.props.forID + '-search', type: 'search', 'data-series-search': '', value: this.state.query, placeholder: '输入文章标题', autoComplete: 'off', onChange: function (event) { self.setState({ query: event.target.value }); } }),
          this.state.loading ? h('p', null, '正在读取文章…') : h('ul', { className: 'series-cards__results' }, available.slice(0, 8).map(function (post) {
            return h('li', { key: post.id }, h('button', { type: 'button', 'data-series-add': '', 'data-post-id': post.id, onClick: function () { self.addPost(post); } }, h('span', null, post.title), h('span', { 'aria-hidden': 'true' }, '+ 添加')));
          })),
          !this.state.loading && !this.state.error && available.length === 0 && h('p', null, query ? '没有找到可添加的文章，换个关键词试试。' : '已发布文章都已加入这个合集。'),
          available.length > 8 && h('p', { className: 'series-cards__help' }, '显示前 8 篇，输入关键词可继续查找。')
        ),
        h('ol', { className: 'series-cards__list', 'aria-label': '合集阅读顺序' }, list),
        entries.length === 0 && h('p', { className: 'series-cards__empty' }, '还没有文章。点击“添加文章”，开始安排阅读顺序。'),
        h('p', { className: 'series-cards__status', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' }, this.state.message),
        drag && h('div', { className: 'series-cards__ghost', 'data-series-ghost': '', 'aria-hidden': 'true', style: { width: drag.width, left: drag.x - drag.offsetX, top: drag.y - drag.offsetY } }, h('span', { className: 'series-cards__ghost-label' }, '正在移动 · 第 ' + (drag.target + 1) + ' 篇'), h('strong', null, ghost.title), ghost.description && h('p', null, ghost.description))
      );
    }
  });

  window.CMS.registerWidget('seriescards', SeriesCards);
}());
