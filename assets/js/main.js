/* =========================================================
   Кофейня «Сфера» — интерактив
   ========================================================= */
(function () {
  'use strict';

  /* ---------- Мобильное меню ---------- */
  const burger = document.getElementById('burger');
  const nav = document.getElementById('nav');

  if (burger && nav) {
    const setOpen = (open) => {
      nav.classList.toggle('is-open', open);
      burger.setAttribute('aria-expanded', String(open));
    };

    burger.addEventListener('click', () => {
      setOpen(!nav.classList.contains('is-open'));
    });

    nav.addEventListener('click', (e) => {
      if (e.target.closest('a')) setOpen(false);
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') setOpen(false);
    });

    window.addEventListener('resize', () => {
      if (window.innerWidth > 880) setOpen(false);
    });
  }

  /* ---------- Тень у шапки при прокрутке ---------- */
  const header = document.querySelector('.site-header');
  const toTop = document.getElementById('toTop');

  const onScroll = () => {
    const y = window.scrollY;
    if (header) header.classList.toggle('is-scrolled', y > 12);
    if (toTop) toTop.classList.toggle('is-visible', y > 700);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ---------- Табы меню ---------- */
  const tabs = Array.from(document.querySelectorAll('.tab'));

  const activate = (tab, focus) => {
    tabs.forEach((t) => {
      const selected = t === tab;
      t.classList.toggle('is-active', selected);
      t.setAttribute('aria-selected', String(selected));
      t.tabIndex = selected ? 0 : -1;

      const panel = document.getElementById(t.getAttribute('aria-controls'));
      if (panel) {
        panel.hidden = !selected;
        panel.classList.toggle('is-active', selected);
      }
    });
    if (focus) tab.focus();
    tab.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  };

  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => activate(tab));

    tab.addEventListener('keydown', (e) => {
      const map = { ArrowRight: 1, ArrowLeft: -1 };
      if (e.key in map) {
        e.preventDefault();
        activate(tabs[(i + map[e.key] + tabs.length) % tabs.length], true);
      } else if (e.key === 'Home') {
        e.preventDefault();
        activate(tabs[0], true);
      } else if (e.key === 'End') {
        e.preventDefault();
        activate(tabs[tabs.length - 1], true);
      }
    });
  });

  /* ---------- Появление блоков при прокрутке ---------- */
  const revealTargets = document.querySelectorAll(
    '.section-head, .feature, .g-card, .review, .menu-card, .tabs, .atmo-strip, .loyalty-inner, .contact-block, .map-card'
  );

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if ('IntersectionObserver' in window && !reduceMotion) {
    revealTargets.forEach((el, i) => {
      el.classList.add('reveal');
      el.style.transitionDelay = (i % 4) * 70 + 'ms';
    });

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-in');
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
    );

    revealTargets.forEach((el) => io.observe(el));
  }

  /* ---------- Подсветка активного пункта навигации ---------- */
  const sections = Array.from(document.querySelectorAll('main section[id]'));
  const navLinks = Array.from(document.querySelectorAll('.nav a[href^="#"]'));

  if (sections.length && navLinks.length && 'IntersectionObserver' in window) {
    const spy = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const id = '#' + entry.target.id;
          navLinks.forEach((a) => a.classList.toggle('is-active', a.getAttribute('href') === id));
        });
      },
      { rootMargin: '-45% 0px -50% 0px' }
    );
    sections.forEach((s) => spy.observe(s));
  }

  /* ---------- Год в подвале ---------- */
  const year = document.getElementById('year');
  if (year) year.textContent = new Date().getFullYear();
})();
