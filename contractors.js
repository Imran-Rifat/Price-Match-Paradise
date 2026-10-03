/* Progressive enhancement only: email and template links also work without JS. */
(function () {
  'use strict';

  const consentKey = 'pmp-ad-consent-v1';
  const banner = document.getElementById('consentBanner');
  const privacyChoices = document.getElementById('privacyChoices');
  let measurementAllowed = false;
  let googleLoaded = false;

  function readConsent() {
    try { return localStorage.getItem(consentKey); } catch (error) { return null; }
  }

  function loadMeasurement() {
    if (googleLoaded) return;
    googleLoaded = true;
    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
    window.gtag('consent', 'default', {
      ad_storage: 'denied', analytics_storage: 'denied',
      ad_user_data: 'denied', ad_personalization: 'denied'
    });
    window.gtag('js', new Date());
    window.gtag('config', 'AW-18175529367');
    const script = document.createElement('script');
    script.async = true;
    script.src = 'https://www.googletagmanager.com/gtag/js?id=AW-18175529367';
    document.head.appendChild(script);
  }

  function applyConsent(value, remember) {
    measurementAllowed = value === 'granted';
    if (remember) {
      try { localStorage.setItem(consentKey, value); } catch (error) { /* Choice still applies to this page. */ }
    }
    if (measurementAllowed) loadMeasurement();
    if (typeof window.gtag === 'function') {
      const setting = measurementAllowed ? 'granted' : 'denied';
      window.gtag('consent', 'update', {
        ad_storage: setting, analytics_storage: setting,
        ad_user_data: setting, ad_personalization: setting
      });
    }
    banner.hidden = true;
  }

  const savedConsent = readConsent();
  if (savedConsent === 'granted' || savedConsent === 'denied') applyConsent(savedConsent, false);
  else banner.hidden = false;
  privacyChoices.hidden = false;
  privacyChoices.addEventListener('click', function () {
    banner.hidden = false;
    document.getElementById('rejectConsent').focus();
  });
  document.getElementById('acceptConsent').addEventListener('click', function () { applyConsent('granted', true); });
  document.getElementById('rejectConsent').addEventListener('click', function () { applyConsent('denied', true); });

  document.querySelectorAll('[data-b2b-event]').forEach(function (link) {
    link.addEventListener('click', function () {
      if (!measurementAllowed || typeof window.gtag !== 'function') return;
      const eventName = link.dataset.b2bEvent;
      if (eventName !== 'b2b_email_click' && eventName !== 'b2b_template_download') return;
      // Inquiry intent only. No contact details, documents, fees, or achieved-savings data.
      window.gtag('event', eventName, { event_category: 'contractor_inquiry', transport_type: 'beacon' });
    });
  });

  const copyButton = document.getElementById('copyEmail');
  const copyStatus = document.getElementById('copyStatus');
  if (navigator.clipboard && window.isSecureContext) {
    copyButton.hidden = false;
    copyButton.addEventListener('click', async function () {
      try {
        await navigator.clipboard.writeText('imran@pricematchparadise.com');
        copyStatus.textContent = 'Email address copied.';
      } catch (error) {
        copyStatus.textContent = 'Please select and copy the address above.';
      }
    });
  }
}());
