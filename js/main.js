/* 交互:滚动进场 + 终端打字 + 节点状态 + 工作流导航 + 点击爆墨 + 终端彩蛋 */
(function () {
  'use strict';

  // ---------- 滚动进场 ----------
  var revealObserver = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        revealObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });

  document.querySelectorAll('main .reveal, .footer .reveal').forEach(function (el) {
    revealObserver.observe(el);
  });

  // ---------- 终端打字机 ----------
  var typeline = document.getElementById('typeline');
  var bootLog = document.getElementById('bootLog');
  if (typeline && bootLog) {
    var cmd = 'agent.run("调研:akaxxx 是谁?")';
    var logs = bootLog.querySelectorAll('li');
    var idx = 0;

    var typeNext = function () {
      if (idx <= cmd.length) {
        typeline.textContent = cmd.slice(0, idx);
        idx++;
        setTimeout(typeNext, 36 + Math.random() * 50);
      } else {
        showLogs(0);
      }
    };

    var showLogs = function (i) {
      if (i >= logs.length) return;
      setTimeout(function () {
        logs[i].classList.add('shown');
        showLogs(i + 1);
      }, i === 0 ? 350 : 420);
    };

    setTimeout(typeNext, 600);
  }

  // ---------- 节点状态: idle → running → done ----------
  var statusObserver = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      var badge = entry.target;
      statusObserver.unobserve(badge);
      badge.setAttribute('data-state', 'running');
      setTimeout(function () {
        badge.setAttribute('data-state', 'done');
      }, 1100 + Math.random() * 600);
    });
  }, { threshold: 0.4 });

  document.querySelectorAll('.node-status').forEach(function (el) {
    statusObserver.observe(el);
  });

  // ---------- 左侧工作流导航 ----------
  var railNodes = document.querySelectorAll('.rail-node[data-section]');
  var railProgress = document.getElementById('railProgress');

  // 各区块对应的流体墨色
  var sectionPalettes = {
    top: 'ink', about: 'ink', skills: 'teal', projects: 'cyan',
    papers: 'violet', edu: 'indigo', interests: 'amber', contact: 'rose', end: 'rose',
  };
  var lastFluidSection = null;

  if (railNodes.length && railProgress) {
    var sectionIds = ['about', 'skills', 'projects', 'papers', 'edu', 'interests', 'contact'];
    var sections = sectionIds
      .map(function (id) { return document.getElementById(id); })
      .filter(Boolean);

    var syncRail = function () {
      var scrollY = window.scrollY;
      var viewportMid = scrollY + window.innerHeight * 0.45;

      var current = 'top';
      for (var i = 0; i < sections.length; i++) {
        if (viewportMid >= sections[i].offsetTop) current = sections[i].id;
      }
      var doc = document.documentElement;
      var atBottom = scrollY + window.innerHeight >= doc.scrollHeight - 40;
      if (atBottom) current = 'end';

      // 进入新区块:给流体背景换一种墨色并注入几团新墨
      if (current !== lastFluidSection) {
        lastFluidSection = current;
        var paletteName = sectionPalettes[current] || 'ink';
        if (typeof window.fluidPalette === 'function') {
          window.fluidPalette(paletteName);
          if (typeof window.fluidInject === 'function') window.fluidInject(2);
        }
      }

      var beforeActive = true;
      railNodes.forEach(function (node) {
        var sec = node.getAttribute('data-section');
        var isActive = sec === current;
        node.classList.toggle('active', isActive);
        if (isActive) beforeActive = false;
        node.classList.toggle('passed', beforeActive && !isActive);
      });

      var progress = Math.min(scrollY / (doc.scrollHeight - window.innerHeight), 1);
      railProgress.style.height = (progress * 100) + '%';
    };

    window.addEventListener('scroll', syncRail, { passive: true });
    window.addEventListener('resize', syncRail);
    syncRail();
  }

  // ---------- 标题逐字飞入 ----------
  document.querySelectorAll('.section-head h2, .contact-title').forEach(function (h) {
    var nodes = Array.prototype.slice.call(h.childNodes);
    var i = 0;
    nodes.forEach(function (n) {
      if (n.nodeType === 3) {
        var frag = document.createDocumentFragment();
        n.textContent.split('').forEach(function (c) {
          var s = document.createElement('span');
          s.className = 'ch';
          s.textContent = c;
          s.style.transitionDelay = (i++ * 45) + 'ms';
          frag.appendChild(s);
        });
        h.replaceChild(frag, n);
      } else if (n.nodeType === 1) {
        n.classList.add('ch');
        n.style.transitionDelay = (i++ * 45) + 'ms';
      }
    });
  });

  // ---------- 卡片聚光灯 + 3D 跟随倾斜 ----------
  // .tilting 关闭 transform 过渡,避免被 reveal 的弹簧曲线拖拽导致乱晃
  document.querySelectorAll('.glass').forEach(function (card) {
    card.addEventListener('pointermove', function (e) {
      if (e.pointerType === 'touch') return;
      if (!card.classList.contains('visible') && card.classList.contains('reveal')) return;
      var r = card.getBoundingClientRect();
      var px = e.clientX - r.left;
      var py = e.clientY - r.top;
      card.style.setProperty('--mx', px + 'px');
      card.style.setProperty('--my', py + 'px');
      card.classList.add('tilting');
      var rx = (py / r.height - 0.5) * -5;
      var ry = (px / r.width - 0.5) * 7;
      card.style.transform = 'perspective(900px) rotateX(' + rx.toFixed(2) + 'deg) rotateY(' + ry.toFixed(2) + 'deg) translateY(-4px)';
    });
    card.addEventListener('pointerleave', function () {
      card.classList.remove('tilting');
      card.style.transform = '';
    });
  });

  // ---------- AKAXXX 字母:入场动画结束后释放 transform 控制权,让 CSS hover 生效 ----------
  document.querySelectorAll('.hero-name .ltr').forEach(function (l) {
    l.addEventListener('animationend', function () {
      l.style.opacity = '1';
      l.style.animation = 'none';
    });
  });

  // ---------- 节点名解码动画 ----------
  var scramble = function (el) {
    var finalText = el.getAttribute('data-final');
    var pool = 'ABCDEFGHJKMNPQRSTUVWXYZ0123456789#$%&_';
    var frame = 0;
    var total = 24;
    el.classList.add('scrambling');
    var timer = setInterval(function () {
      frame++;
      var resolved = Math.floor((frame / total) * finalText.length);
      var out = '';
      for (var i = 0; i < finalText.length; i++) {
        var c = finalText[i];
        out += (i < resolved || c === ' ' || c === '·') ? c : pool[Math.floor(Math.random() * pool.length)];
      }
      el.textContent = out;
      if (frame >= total) {
        clearInterval(timer);
        el.textContent = finalText;
        el.classList.remove('scrambling');
      }
    }, 34);
  };

  document.querySelectorAll('.section-log').forEach(function (log) {
    Array.prototype.slice.call(log.childNodes).forEach(function (n) {
      if (n.nodeType === 3 && n.textContent.trim()) {
        var span = document.createElement('span');
        span.className = 'decode';
        span.setAttribute('data-final', n.textContent);
        span.textContent = n.textContent;
        log.replaceChild(span, n);
      }
    });
  });

  var decodeObserver = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      decodeObserver.unobserve(entry.target);
      scramble(entry.target);
    });
  }, { threshold: 0.5 });

  document.querySelectorAll('.decode').forEach(function (el) {
    decodeObserver.observe(el);
  });

  // ---------- Konami 秘籍:整页翻滚 + 墨水风暴 ----------
  var konami = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
  var konamiPos = 0;
  document.addEventListener('keydown', function (e) {
    var k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    konamiPos = (k === konami[konamiPos]) ? konamiPos + 1 : (k === konami[0] ? 1 : 0);
    if (konamiPos === konami.length) {
      konamiPos = 0;
      document.body.classList.add('barrel');
      for (var i = 0; i < 10; i++) {
        setTimeout(function () {
          if (typeof window.fluidBurst === 'function') {
            window.fluidBurst(Math.random() * window.innerWidth, Math.random() * window.innerHeight);
          }
        }, i * 120);
      }
    }
  });
  document.body.addEventListener('animationend', function (e) {
    if (e.animationName === 'barrelRoll') document.body.classList.remove('barrel');
  });

  // ---------- 磁吸按钮(触屏跳过,避免手指滑过把按钮拖走) ----------
  document.querySelectorAll('.hero-cta .btn').forEach(function (btn) {
    btn.addEventListener('pointermove', function (e) {
      if (e.pointerType === 'touch') return;
      var r = btn.getBoundingClientRect();
      var dx = e.clientX - (r.left + r.width / 2);
      var dy = e.clientY - (r.top + r.height / 2);
      btn.style.transform = 'translate(' + dx * 0.22 + 'px,' + dy * 0.34 + 'px)';
    });
    btn.addEventListener('pointerleave', function () {
      btn.style.transform = '';
    });
  });

  // ---------- 滚动视差:hero 渐隐 + 幽灵数字漂移 ----------
  var heroInner = document.querySelector('.hero-inner');
  var ghosts = document.querySelectorAll('.ghost-no');
  var ticking = false;

  function parallax() {
    ticking = false;
    var y = window.scrollY;
    // 只做淡出,不做位移,避免内容看起来在"往下掉"
    if (heroInner) {
      heroInner.style.opacity = y < window.innerHeight
        ? Math.max(0, 1 - y / 720).toFixed(3)
        : '0';
    }
    ghosts.forEach(function (g) {
      var rect = g.parentElement.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > window.innerHeight) return;
      var off = (rect.top - window.innerHeight * 0.5) * -0.14;
      g.style.setProperty('--py', off.toFixed(1) + 'px');
    });
  }

  window.addEventListener('scroll', function () {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(parallax);
    }
  }, { passive: true });
  parallax();

  // ---------- 点击爆墨 ----------
  var hero = document.querySelector('.hero');
  if (hero) {
    hero.addEventListener('click', function (e) {
      if (e.target.closest('a, button, input')) return;
      if (typeof window.fluidBurst === 'function') {
        window.fluidBurst(e.clientX, e.clientY);
      }
    });
  }

  // ---------- 3D 打印进度(与 12s 动画周期同步) ----------
  var printPct = document.getElementById('printPct');
  if (printPct) {
    var printStart = Date.now();
    setInterval(function () {
      var t = (Date.now() - printStart) % 12000;
      // 八层在周期 85% 处完成堆叠,之后保持 100%
      var pct = Math.min(100, Math.round((t / (12000 * 0.85)) * 100));
      printPct.textContent = pct;
    }, 150);
  }

  // ---------- 无人机飞越彩蛋 ----------
  var flyby = document.getElementById('droneFlyby');
  if (flyby) {
    var launch = function () {
      flyby.classList.add('fly');
    };
    flyby.addEventListener('animationend', function (e) {
      if (e.animationName === 'flyAcross') flyby.classList.remove('fly');
    });
    setTimeout(launch, 6000);
    setInterval(launch, 32000);
  }

  // ---------- Footer 运行计时 ----------
  var runTime = document.getElementById('runTime');
  if (runTime) {
    var start = Date.now();
    setInterval(function () {
      runTime.textContent = ((Date.now() - start) / 1000).toFixed(1);
    }, 100);
  }

  // ---------- 终端彩蛋 ----------
  var palette = document.getElementById('palette');
  var paletteOut = document.getElementById('paletteOut');
  var paletteInput = document.getElementById('paletteInput');
  var paletteClose = document.getElementById('paletteClose');
  var paletteBackdrop = document.getElementById('paletteBackdrop');
  var navStatus = document.getElementById('navStatus');

  if (palette && paletteOut && paletteInput) {
    var greeted = false;

    var print = function (html, cls) {
      var div = document.createElement('div');
      if (cls) div.className = cls;
      div.innerHTML = html;
      paletteOut.appendChild(div);
      paletteOut.scrollTop = paletteOut.scrollHeight;
    };

    var goTo = function (id, label) {
      print('→ 跳转 ' + label, 'p-ok');
      setTimeout(function () {
        closePalette();
        document.getElementById(id).scrollIntoView({ behavior: 'smooth' });
      }, 300);
    };

    var openPalette = function () {
      palette.hidden = false;
      paletteInput.value = '';
      paletteInput.focus();
      if (!greeted) {
        greeted = true;
        print('akaxxx interactive shell · 输入 <b>help</b> 查看命令');
      }
    };

    var closePalette = function () {
      palette.hidden = true;
      paletteInput.blur();
    };

    var commands = {
      help: function () {
        print('可用命令:');
        print('&nbsp;&nbsp;whoami&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;— 我是谁');
        print('&nbsp;&nbsp;about / skills / projects / papers / edu / interests / contact — 跳转对应区块');
        print('&nbsp;&nbsp;drone&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;— 呼叫一架无人机');
        print('&nbsp;&nbsp;nas&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;— 查看存储池状态');
        print('&nbsp;&nbsp;github&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;— 打开 GitHub');
        print('&nbsp;&nbsp;joke&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;— 讲个笑话');
        print('&nbsp;&nbsp;sudo hire akaxxx — 你懂的');
        print('&nbsp;&nbsp;clear / exit');
        print('另外,这个页面认识一个古老的秘籍:↑↑↓↓←→←→BA', 'p-warn');
      },
      whoami: function () {
        print('akaxxx — AI Agent / 全栈开发工程师');
        print('深度学习图像分析研究者 · 两篇论文在审 · 商业项目上线运营中');
        print('构建会思考的 Agent,也写跑在生产环境的系统。');
        print('热爱 vibe coding · 3D 打印 · 无人机 · 智能设备 · 桌搭 · NAS 重度用户。');
      },
      about: function () { goTo('about', '#about'); },
      skills: function () { goTo('skills', '#skills'); },
      projects: function () { goTo('projects', '#projects'); },
      papers: function () { goTo('papers', '#papers'); },
      edu: function () { goTo('edu', '#edu'); },
      interests: function () { goTo('interests', '#interests'); },
      contact: function () { goTo('contact', '#contact'); },
      nas: function () {
        print('storage pool · RAID5 · <span class="p-ok">healthy</span>');
        print('&nbsp;&nbsp;photos&nbsp;&nbsp;&nbsp;&nbsp;████████░░&nbsp;&nbsp;8.2T / 10T');
        print('&nbsp;&nbsp;media&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;███████░░░&nbsp;&nbsp;6.9T / 10T');
        print('&nbsp;&nbsp;backups&nbsp;&nbsp;&nbsp;██░░░░░░░░&nbsp;&nbsp;1.8T / 10T');
        print('uptime: 247 天 · 自托管服务 12 个 · 一切尽在掌握', 'p-ok');
      },
      drone: function () {
        var fb = document.getElementById('droneFlyby');
        if (fb && !fb.classList.contains('fly')) {
          print('无人机起飞 ✓ 注意头顶', 'p-ok');
          setTimeout(function () { fb.classList.add('fly'); }, 200);
        } else {
          print('无人机正在飞行中…', 'p-warn');
        }
      },
      github: function () {
        print('→ 打开 GitHub…', 'p-ok');
        window.open('https://github.com/xxx-0425', '_blank', 'noopener');
      },
      joke: function () {
        var jokes = [
          '为什么程序员分不清万圣节和圣诞节?因为 Oct 31 == Dec 25。',
          '我的 Agent 陷入了死循环——它在反思自己为什么陷入死循环。',
          '99 个 bug 在代码里,修掉一个,还剩 127 个。',
          'RAG 的本质:开卷考试,但书是自己提前放进去的。',
        ];
        print(jokes[Math.floor(Math.random() * jokes.length)]);
      },
      clear: function () { paletteOut.innerHTML = ''; },
      exit: function () { closePalette(); },
    };

    var run = function (raw) {
      var input = raw.trim();
      if (!input) return;
      print(escapeHtml(input), 'p-cmd');

      var lower = input.toLowerCase();
      if (lower === 'sudo hire akaxxx') {
        print('权限确认 ✓', 'p-ok');
        print('正在生成 offer 草稿 → <a href="mailto:clarkakaxxx@gmail.com">clarkakaxxx@gmail.com</a>');
        return;
      }
      if (lower.indexOf('sudo') === 0) {
        print('permission denied: 这里只有一条 sudo 命令是被允许的 :)', 'p-err');
        return;
      }
      var fn = commands[lower];
      if (fn) {
        fn();
      } else {
        print('command not found: ' + escapeHtml(input) + ' · 试试 help', 'p-err');
      }
    };

    var escapeHtml = function (s) {
      return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    };

    paletteInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        run(paletteInput.value);
        paletteInput.value = '';
      }
    });

    document.addEventListener('keydown', function (e) {
      var tag = document.activeElement && document.activeElement.tagName;
      var typing = tag === 'INPUT' || tag === 'TEXTAREA';
      if (e.key === '/' && !typing) {
        e.preventDefault();
        openPalette();
      } else if (e.key === 'Escape' && !palette.hidden) {
        closePalette();
      }
    });

    if (navStatus) navStatus.addEventListener('click', openPalette);
    if (paletteClose) paletteClose.addEventListener('click', closePalette);
    if (paletteBackdrop) paletteBackdrop.addEventListener('click', closePalette);
  }
})();
