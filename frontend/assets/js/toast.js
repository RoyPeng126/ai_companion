(() => {
  const TOAST_LIFETIME = 3200
  const TOAST_HIDE_DELAY = 250

  function ensureContainer () {
    let container = document.querySelector('.toast-stack')
    if (!container) {
      container = document.createElement('div')
      container.className = 'toast-stack'
      Object.assign(container.style, {
        position: 'fixed',
        top: '16px',
        right: '16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        zIndex: '9999',
        pointerEvents: 'none'
      })
      document.body.appendChild(container)
    }
    return container
  }

  function createToastElement (message, variant) {
    const el = document.createElement('div')
    el.className = `toast toast--${variant ?? 'info'}`
    Object.assign(el.style, {
      minWidth: '220px',
      maxWidth: '320px',
      padding: '12px 16px',
      borderRadius: '12px',
      color: '#fff',
      fontSize: '0.95rem',
      boxShadow: '0 10px 20px rgba(15, 23, 42, 0.18)',
      backdropFilter: 'blur(12px)',
      background: variant === 'error'
        ? 'linear-gradient(135deg, #ef4444, #b91c1c)'
        : variant === 'success'
          ? 'linear-gradient(135deg, #10b981, #059669)'
          : 'linear-gradient(135deg, #3b82f6, #1d4ed8)',
      transform: 'translateY(-8px)',
      opacity: '0',
      transition: 'opacity 0.18s ease, transform 0.18s ease',
      pointerEvents: 'auto'
    })
    el.textContent = message
    requestAnimationFrame(() => {
      el.style.opacity = '1'
      el.style.transform = 'translateY(0)'
    })
    return el
  }

  function showToast (message, options = {}) {
    const container = ensureContainer()
    const variant = options.variant || 'info'
    const toastEl = createToastElement(message, variant)
    container.appendChild(toastEl)

    const lifetime = Number.isFinite(options.duration) ? options.duration : TOAST_LIFETIME
    const timer = setTimeout(() => {
      toastEl.style.opacity = '0'
      toastEl.style.transform = 'translateY(-8px)'
      setTimeout(() => {
        toastEl.remove()
      }, TOAST_HIDE_DELAY)
    }, lifetime)

    toastEl.addEventListener('click', () => {
      clearTimeout(timer)
      toastEl.style.opacity = '0'
      toastEl.style.transform = 'translateY(-8px)'
      setTimeout(() => toastEl.remove(), TOAST_HIDE_DELAY)
    })
  }

  window.showToast = showToast
})()
