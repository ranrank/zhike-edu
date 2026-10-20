const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {transcript, enrollment, seats, setSeats, setStatus} = require('./support.cjs');

async function runBrowser(context) {
  const {chromium} = require(process.env.CAMPUS_PLAYWRIGHT_MODULE || 'playwright');
  const browser = await chromium.launch({headless: true, channel: process.env.CAMPUS_BROWSER_CHANNEL || 'chrome'});
  const results = [];
  const errors = [];
  const pageByUser = {};
  try {
    async function pageFor(key) {
      if (pageByUser[key]) return pageByUser[key];
      const user = context.users[key];
      const page = await browser.newPage({viewport: {width: 1440, height: 1080}});
      page.setDefaultTimeout(60000);
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(context.frontend + '/login');
      await page.getByPlaceholder('请输入用户名').fill(user.username);
      await page.getByPlaceholder('请输入密码').fill(user.password);
      await page.getByRole('button', {name: '登录', exact: true}).click();
      await page.waitForURL('**/chat');
      pageByUser[key] = page;
      return page;
    }
    async function send(page, question, name) {
      await page.getByRole('button', {name: /新建会话/}).click();
      await page.getByRole('textbox', {name: '消息', exact: true}).fill(question);
      const pending = page.waitForResponse(r => r.url().includes('/agent/v1/chat?') && r.request().method() === 'GET');
      await page.getByRole('button', {name: '发送', exact: true}).click();
      const raw = await (await pending).text();
      fs.writeFileSync(path.join(context.directory, name + '-request.sse'), raw);
      const output = transcript(raw);
      assert(!output.errored, 'Conversation interrupted');
      return output;
    }
    async function confirm(page, approved, name) {
      const button = page.getByRole('button', {name: approved ? '确认执行' : '取消', exact: true});
      await button.waitFor({state: 'visible'});
      await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent.trim() === '确认执行' && !b.disabled));
      await page.screenshot({path: path.join(context.directory, name + '-confirmation.png'), fullPage: true});
      const pending = page.waitForResponse(r => r.url().includes('/agent/v1/chat/confirm') && r.request().method() === 'POST');
      await button.click();
      const raw = await (await pending).text();
      fs.writeFileSync(path.join(context.directory, name + '-confirmation.sse'), raw);
      const output = transcript(raw);
      assert(!output.errored, 'Confirmation interrupted');
      assert.equal(output.finish?.messageStatus, 'NORMAL', 'Confirmation did not finish normally');
      await page.screenshot({path: path.join(context.directory, name + '-result.png'), fullPage: true});
      return output;
    }
    async function scenario(name, run) {
      const start = Date.now();
      try {
        const details = await run();
        results.push({name, passed: true, elapsedMs: Date.now() - start, ...details});
        console.log('[browser] PASS ' + name);
      } catch (error) {
        results.push({name, passed: false, elapsedMs: Date.now() - start, error: error.message});
        console.log('[browser] FAIL ' + name + ': ' + error.message);
      }
      fs.writeFileSync(path.join(context.directory, 'browser-results.json'), JSON.stringify({results, errors}, null, 2));
    }
    const normalPage = await pageFor('sophomore');
    const retakePage = await pageFor('retake');
    const normal = context.courses.normalWrite;
    const retake = context.courses.retakeWrite;

    async function requestEnrollment(page, course, name, isRetake = false) {
      const output = await send(page, `请为我${isRetake ? '办理重修报名' : '选课报名'}：课程代码 ${course.code}。这是本地教务演示课程，请调用${isRetake ? '重修' : '选课'}工具并展示确认卡。`, name);
      assert(output.events.some(v => v.eventType === 'confirm'), 'No confirmation card');
      const expectedTool = isRetake ? 'register_course_retake' : 'enroll_course';
      assert(output.events.some(v => v.eventType === 'confirm' && v.calls?.some(call => call.name === expectedTool)), 'Wrong write tool');
      return output;
    }
    await scenario('normal-cancel', async () => {
      const before = seats(normal);
      await requestEnrollment(normalPage, normal, 'normal-cancel');
      assert.equal(enrollment(context.users.sophomore, normal).count, 0);
      assert.equal(seats(normal), before);
      await confirm(normalPage, false, 'normal-cancel');
      assert.equal(enrollment(context.users.sophomore, normal).count, 0);
      assert.equal(seats(normal), before);
      return {rowsBefore: 0, rowsAfter: 0, seatsBefore: before, seatsAfter: seats(normal)};
    });
    await scenario('normal-confirm', async () => {
      const before = seats(normal);
      await requestEnrollment(normalPage, normal, 'normal-confirm');
      assert.equal(enrollment(context.users.sophomore, normal).count, 0);
      const output = await confirm(normalPage, true, 'normal-confirm');
      assert(output.completed.some(v => v.name === 'enroll_course' && v.ok));
      assert.equal(enrollment(context.users.sophomore, normal).count, 1);
      assert.equal(seats(normal), before - 1);
      return {rowsBefore: 0, rowsAfter: 1, seatsBefore: before, seatsAfter: seats(normal)};
    });
    await scenario('normal-repeat', async () => {
      const before = enrollment(context.users.sophomore, normal);
      assert.equal(before.count, 1);
      const remaining = seats(normal);
      const output = await send(normalPage, `请再提交一次课程 ${normal.code} 的普通选课；若已报名就返回原记录，不要重复占名额。`, 'normal-repeat');
      if (output.events.some(v => v.eventType === 'confirm')) await confirm(normalPage, true, 'normal-repeat');
      else assert.equal(output.finish?.messageStatus, 'NORMAL');
      assert.deepEqual(enrollment(context.users.sophomore, normal), before);
      assert.equal(seats(normal), remaining);
      return {rowsAfter: 1, sameEnrollmentId: true, additionalSeatsConsumed: 0};
    });
    await scenario('retake-confirm', async () => {
      const before = seats(retake);
      await requestEnrollment(retakePage, retake, 'retake-confirm', true);
      assert.equal(enrollment(context.users.retake, retake).count, 0);
      const output = await confirm(retakePage, true, 'retake-confirm');
      assert(output.completed.some(v => v.name === 'register_course_retake' && v.ok));
      assert.equal(enrollment(context.users.retake, retake).count, 1);
      assert.equal(seats(retake), before - 1);
      return {rowsBefore: 0, rowsAfter: 1, seatsBefore: before, seatsAfter: seats(retake)};
    });
    await scenario('retake-repeat', async () => {
      const before = enrollment(context.users.retake, retake);
      assert.equal(before.count, 1);
      const remaining = seats(retake);
      const output = await send(retakePage, `请再提交一次课程 ${retake.code} 的重修报名；如果已报名就告诉我原记录。`, 'retake-repeat');
      if (output.events.some(v => v.eventType === 'confirm')) await confirm(retakePage, true, 'retake-repeat');
      else assert.equal(output.finish?.messageStatus, 'NORMAL');
      assert.deepEqual(enrollment(context.users.retake, retake), before);
      assert.equal(seats(retake), remaining);
      return {sameEnrollmentId: true, additionalSeatsConsumed: 0};
    });
    await scenario('retake-without-failed-grade', async () => {
      const before = seats(retake);
      const output = await send(normalPage, `请帮我办理课程 ${retake.code} 的重修报名，按系统成绩判断，不编造未通过记录。`, 'retake-no-grade');
      let continuation;
      if (output.events.some(v => v.eventType === 'confirm')) continuation = await confirm(normalPage, true, 'retake-no-grade');
      else assert.equal(output.finish?.messageStatus, 'NORMAL');
      assert.equal(enrollment(context.users.sophomore, retake).count, 0);
      assert.equal(seats(retake), before);
      assert(!continuation?.completed.some(v => v.name === 'register_course_retake' && v.ok));
      assert(continuation?.failed.some(v => v.name === 'register_course_retake') ||
        /不能.{0,15}重修|无法.{0,15}重修|没有.{0,20}(未通过|不及格|成绩)|未通过记录|不满足/.test(output.answer), 'Missing retake refusal');
      return {rowsAfter: 0, seatsUnchanged: true};
    });
    await scenario('seat-changed-before-confirmation', async () => {
      const course = context.courses.seatRace;
      await requestEnrollment(normalPage, course, 'seat-race');
      assert.equal(enrollment(context.users.sophomore, course).count, 0);
      setSeats(context, course, 0);
      const output = await confirm(normalPage, true, 'seat-race');
      assert.equal(enrollment(context.users.sophomore, course).count, 0);
      assert.equal(seats(course), 0);
      assert(!output.completed.some(v => v.name === 'enroll_course' && v.ok));
      assert(output.failed.some(v => v.name === 'enroll_course'), 'Expected service rejection after seats changed');
      return {rowsAfter: 0, staleQualificationRejected: true};
    });
    await scenario('status-changed-before-confirmation', async () => {
      const course = context.courses.statusRace;
      const before = seats(course);
      await requestEnrollment(normalPage, course, 'status-race');
      setStatus(context, 'sophomore', 'SUSPENDED');
      try {
        const output = await confirm(normalPage, true, 'status-race');
        assert.equal(enrollment(context.users.sophomore, course).count, 0);
        assert.equal(seats(course), before);
        assert(!output.completed.some(v => v.name === 'enroll_course' && v.ok));
        assert(output.failed.some(v => v.name === 'enroll_course'), 'Expected service rejection after status changed');
      } finally {
        setStatus(context, 'sophomore', 'ACTIVE');
      }
      return {rowsAfter: 0, staleQualificationRejected: true};
    });
    return {results, errors, passed: results.filter(v => v.passed).length, total: results.length};
  } finally {
    await browser.close();
  }
}

module.exports = {runBrowser};
