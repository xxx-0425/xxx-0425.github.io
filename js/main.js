/* 交互:自定义光标 + 滚动进场 */
(function () {
  'use strict';

  // ---------- 自定义光标 ----------
  var dot = document.getElementById('cursorDot');
  var ring = document.getElementById('cursorRing');
  var fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  if (fine && dot && ring) {
    var mouseX = -100, mouseY = -100;
    var ringX = -100, ringY = -100;

    window.addEventListener('mousemove', function (e) {
      mouseX = e.clientX;
      mouseY = e.clientY;
      dot.style.transform = 'translate(' + mouseX + 'px,' + mouseY + 'px) translate(-50%,-50%)';
    });

    (function animateRing() {
      ringX += (mouseX - ringX) * 0.16;
      ringY += (mouseY - ringY) * 0.16;
      ring.style.transform = 'translate(' + ringX + 'px,' + ringY + 'px) translate(-50%,-50%)';
      requestAnimationFrame(animateRing);
    })();

    document.querySelectorAll('a, button').forEach(function (el) {
      el.addEventListener('mouseenter', function () { document.body.classList.add('cursor-hover'); });
      el.addEventListener('mouseleave', function () { document.body.classList.remove('cursor-hover'); });
    });
  } else {
    if (dot) dot.style.display = 'none';
    if (ring) ring.style.display = 'none';
  }

  // ---------- 滚动进场 ----------
  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });

  document.querySelectorAll('main .reveal, .footer .reveal').forEach(function (el) {
    observer.observe(el);
  });
})();
