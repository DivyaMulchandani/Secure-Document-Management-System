'use strict';

const service = require('./auth.service');
const jwtService = require('../../services/jwt');
const config = require('../../config');

const REFRESH_COOKIE = 'refresh_token';

function refreshCookieOptions() {
  return {
    httpOnly: true,
    secure: config.server.nodeEnv === 'production',
    sameSite: 'lax',
    maxAge: jwtService.parseDuration(config.jwt.refreshTtl),
    path: '/',
  };
}

function clientMeta(req) {
  return { ipAddress: req.ip, userAgent: req.headers['user-agent'] || null };
}

async function getHealth(req, res, next) {
  try {
    const result = await service.health();
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

async function login(req, res, next) {
  try {
    const { accessToken, refreshToken, user } = await service.login({
      ...req.body,
      ...clientMeta(req),
    });
    res.cookie(REFRESH_COOKIE, refreshToken, refreshCookieOptions());
    res.status(200).json({ accessToken, user });
  } catch (err) {
    next(err);
  }
}

async function refresh(req, res, next) {
  try {
    const result = await service.refresh({ rawRefreshToken: req.cookies[REFRESH_COOKIE] });
    res.status(200).json(result);
  } catch (err) {
    res.clearCookie(REFRESH_COOKIE, { path: '/' });
    next(err);
  }
}

async function logout(req, res, next) {
  try {
    await service.logout({ rawRefreshToken: req.cookies[REFRESH_COOKIE] });
    res.clearCookie(REFRESH_COOKIE, { path: '/' });
    res.status(200).json({ message: 'Logged out.' });
  } catch (err) {
    next(err);
  }
}

async function enrollMfa(req, res, next) {
  try {
    const result = await service.enrollMfa({ userId: req.user.id, username: req.user.username });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

async function verifyMfa(req, res, next) {
  try {
    const result = await service.verifyMfaEnrollment({ userId: req.user.id, otp: req.body.otp });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

async function getMe(req, res, next) {
  try {
    const result = await service.getMe({ userId: req.user.id });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

module.exports = { getHealth, login, refresh, logout, enrollMfa, verifyMfa, getMe };
