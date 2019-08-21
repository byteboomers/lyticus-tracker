import { version } from "../package.json";

import isObject from "lodash.isobject";

import {
  dispatch,
  withEventDispatcher,
  CONFIGURATION_EVENT,
  PUSH_STATE_EVENT,
  TRACK_EVENT
} from "./event";

import {
  getLifetimeData,
  saveLifetimeData,
  getSessionData,
  saveSessionData
} from "./cookie";

import {
  getEventPath,
  getUrlReferrer,
  isBodyLoaded,
  isDoNotTrack,
  isExternalReferrer,
  isLocalhostReferrer,
  isVisibilityPrerendered,
  sendToBeacon
} from "./utils";

const DEFAULT_OPTIONS = {
  cookies: true,
  development: false,
  getPath: () => window.location.pathname
};

export default class Lyticus {
  constructor(websiteId, options = {}) {
    if (!websiteId) {
      throw new Error("websiteId must be defined");
    }
    if (!isObject(options)) {
      throw new Error("options must be an object");
    }
    this.state = {
      version,
      websiteId,
      referrerTracked: false,
      urlReferrerTracked: false,
      events: [],
      previousPath: null
    };
    this.options = {
      ...DEFAULT_OPTIONS,
      ...options
    };
    window.__LYTICUS__ = this.state;
    dispatch(CONFIGURATION_EVENT, this.state);
  }

  track(event, callback) {
    if (!isBodyLoaded(window)) {
      document.addEventListener("DOMContentLoaded", () => {
        this.track(event, callback);
      });
      return;
    }
    if (isDoNotTrack(window)) {
      return;
    }
    if (isVisibilityPrerendered(window)) {
      return;
    }
    event = {
      ...event,
      websiteId: this.state.websiteId,
      time: new Date().getTime()
    };
    if (this.options.cookies) {
      // Lifetime cookie
      const lifetime = getLifetimeData();
      if (!lifetime.tracked) {
        event.newVisitor = true;
        lifetime.tracked = true;
        saveLifetimeData(lifetime);
      }
      // Session cookie
      const session = getSessionData();
      event.sessionId = session.id;
      if (
        event.type === "page" &&
        !session.events.find(e => e.type === "page" && e.path == event.path)
      ) {
        event.unique = true;
        session.events.push({
          type: event.type,
          path: event.path
        });
      }
      saveSessionData(session); // Always save session data (bump expiry)
    }
    if (!this.options.development) {
      sendToBeacon(event);
    }
    this.state.events.push(event);
    dispatch(TRACK_EVENT, event);
    if (callback) {
      setTimeout(callback, 300);
    }
  }

  trackNavigator() {
    this.track({
      type: "navigator",
      screenWidth: window.innerWidth,
      language: window.navigator.language,
      userAgent: window.navigator.userAgent
    });
  }

  trackPage(path) {
    const event = {
      type: "page",
      path: path || this.options.getPath()
    };
    if (event.path === this.state.previousPath) {
      return;
    }
    this.state.previousPath = event.path;
    // Referrer
    if (
      !this.state.referrerTracked &&
      !isLocalhostReferrer(window) &&
      isExternalReferrer(window)
    ) {
      const referrer = document.referrer;
      if (referrer && referrer.length) {
        event.referrer = referrer;
        this.state.referrerTracked = true;
      }
    }
    // URL referrer
    if (!this.state.urlReferrerTracked) {
      const urlReferrer = getUrlReferrer(window);
      if (urlReferrer && urlReferrer.length) {
        event.urlReferrer = urlReferrer;
        this.state.urlReferrerTracked = true;
      }
    }
    this.track(event);
  }

  trackClick(value, path) {
    this.track({
      type: "click",
      path: path || this.options.getPath(),
      value
    });
  }

  trackOutboundClick(value, url, path) {
    this.track(
      {
        type: "click",
        path: path || this.options.getPath(),
        value
      },
      function callback() {
        document.location = url;
      }
    );
  }

  startHistoryMode() {
    if (window.history && window.history.pushState) {
      window.history.pushState = withEventDispatcher(window.history.pushState)(
        PUSH_STATE_EVENT
      );
      window.addEventListener(PUSH_STATE_EVENT, this.trackPage);
      this.trackPage();
      return true;
    }
    return false;
  }

  stopHistoryMode() {
    window.removeEventListener(PUSH_STATE_EVENT, this.trackPage);
  }

  clickTracker() {
    return event => {
      const path = getEventPath(event) || [];
      for (let element of path) {
        const dataset = element.dataset;
        if (dataset && dataset.trackClick) {
          this.trackClick(dataset.trackClick);
          break;
        }
      }
    };
  }

  getEvents() {
    return this.state.events;
  }

  getVersion() {
    return this.state.version;
  }
}
