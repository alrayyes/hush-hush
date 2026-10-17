import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import * as age from 'age-encryption';
import { expectListParity, expectTouchTargets } from '../layout-parity';

// A timestamp as formatTimestamp writes it, for the parity checks.
const TIMESTAMP = /[A-Z][a-z]{2} \d{1,2}, \d{4}/;

// The audit log against the real server: the object and actor menus filled from
// what is in the log (#323), the table and the phone cards giving the same
// events (#483), the Timestamp header flipping the order (#753), paging past 25
// entries (#895) and the rows-per-page choice living in the address (#897).
// What each control sends and shows is audit-log.svelte.spec.ts's, and the
// filtering and cursors are the Go audit tests'. The log is shared and only
// grows, so this makes its own events (a create, a read and an update of one
// secret, as the signed-in user) and removes the secret again.
test('the audit log shows the real events and pages, flips and sizes through the address', async ({
	page,
	context,
}) => {
	const csrfToken =
		(await context.cookies()).find((c) => c.name === 'csrf_token')?.value ?? '';
	const headers = { 'X-CSRF-Token': csrfToken };

	// Sealing here only needs a well-formed age file, which any recipient gives.
	const recipient = await age.identityToRecipient(await age.generateIdentity());
	const sealFor = async (text: string) => {
		const encrypter = new age.Encrypter();
		encrypter.addRecipient(recipient);
		const sealed = await encrypter.encrypt(text);

		return btoa(String.fromCharCode(...sealed));
	};

	try {
		const created = await page.request.post('/objects', {
			headers,
			data: { slug: 'audit_spec_secret', value: await sealFor('first') },
		});
		expect(created.ok(), await created.text()).toBe(true);
		expect((await page.request.get('/objects/audit_spec_secret')).ok()).toBe(
			true,
		);
		const updated = await page.request.put('/objects/audit_spec_secret', {
			headers,
			data: { value: await sealFor('second') },
		});
		expect(updated.ok(), await updated.text()).toBe(true);

		await page.setViewportSize({ width: 1280, height: 720 });
		await page.goto('/');
		const nav = page.getByRole('navigation', { name: 'Primary', exact: true });
		// #323: the object-id and actor filters are select boxes populated
		// from what actually appears in the log, not free text - this
		// exercises both against the real entries the flow above already
		// produced (a create + read + update for audit_spec_secret,
		// each carrying a real actor).
		await nav.getByRole('link', { name: 'Audit log' }).click();
		await expect(
			page.getByRole('heading', { name: 'Audit log' }),
		).toBeVisible();
		const auditLogResults = await new AxeBuilder({ page })
			.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
			.analyze();
		expect(auditLogResults.violations).toEqual([]);
		await expectListParity(page, {
			path: '/audit-log',
			list: 'Audit events',
			ids: [],
			facts: {
				object: { pattern: /audit_spec_secret/ },
				actor: { pattern: /admin/ },
				'caller address': { pattern: /127\.0\.0\.1/ },
				time: { pattern: TIMESTAMP },
			},
		});

		const rows = page.locator('tbody tr');

		// alrayyes/hush-hush#483: below md the log becomes one card per event,
		// with the action as a text-labelled pill, 44px export buttons and a
		// copyable curl command. Same events as the table, same order.
		const tableRowCount = await rows.count();
		await page.setViewportSize({ width: 390, height: 844 });
		await expect(page.getByRole('table')).toBeHidden();

		const eventList = page.getByRole('list', { name: 'Audit events' });
		const eventCards = eventList.getByRole('listitem');
		await expect(eventCards).toHaveCount(tableRowCount);
		// What a card says, the action as a word and the curl command are
		// audit-log.svelte.spec.ts's. The real log has to give the same count.

		await expectTouchTargets([
			page.getByRole('button', { name: 'Export CSV' }),
			page.getByRole('button', { name: 'Export JSON' }),
			page.getByRole('button', { name: 'Copy command' }),
		]);

		const curlSnippet = page.getByRole('group', { name: 'Query with curl' });
		const auditCardResults = await new AxeBuilder({ page })
			.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
			.analyze();
		expect(auditCardResults.violations).toEqual([]);

		await page.setViewportSize({ width: 1280, height: 720 });
		await expect(page.getByRole('table')).toBeVisible();
		await expect(eventList).toBeHidden();

		// alrayyes/hush-hush#753: the log opens newest first, the Timestamp header
		// flips it, and paging onward uses the cursor that matches the order.
		// The shared log is longer than a page by now, so the first page of the
		// oldest-first order is not the newest-first page turned over. Narrowed to
		// this spec's own secret, the log is small enough for the two to mirror.
		await page
			.getByRole('combobox', { name: 'Object id', exact: true })
			.click();
		await page
			.getByRole('option', { name: 'audit_spec_secret', exact: true })
			.click();
		await expect(page.getByText('object: audit_spec_secret')).toBeVisible();
		await expect(page.locator('tbody tr')).toHaveCount(3);
		const timestampHeader = page.getByRole('columnheader', {
			name: 'Timestamp',
		});
		const orderButton = timestampHeader.getByRole('button', {
			name: /Timestamp/,
		});
		const rowTexts = async () =>
			(await page.locator('tbody tr').allTextContents()).map((text) =>
				text.replace(/\s+/g, ' ').trim(),
			);
		await expect(timestampHeader).toHaveAttribute('aria-sort', 'descending');
		await expect(curlSnippet).toContainText('order=desc');
		const newestFirst = await rowTexts();
		expect(newestFirst.length).toBeGreaterThan(2);

		// That a log which fits a page has no pager, and which cursor Newer and
		// Older send in either order, are audit-log.svelte.spec.ts's.
		await orderButton.click();
		await expect(timestampHeader).toHaveAttribute('aria-sort', 'ascending');
		await expect(curlSnippet).toContainText('order=asc');
		await expect.poll(rowTexts).toEqual([...newestFirst].reverse());
		await orderButton.click();
		await expect(timestampHeader).toHaveAttribute('aria-sort', 'descending');
		await expect.poll(rowTexts).toEqual(newestFirst);
		const orderResults = await new AxeBuilder({ page })
			.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
			.analyze();
		expect(orderResults.violations).toEqual([]);

		// That the newer of two order changes wins when the older fetch arrives
		// last (#922), and that a failed change puts the controls back and keeps
		// the table (#921), are audit-log.svelte.spec.ts's.
		const actorTrigger = page.getByRole('combobox', {
			name: 'Actor',
			exact: true,
		});

		// The menus' options (including no `none` while every entry is attributed,
		// #438/#446, which is a store test), the chips, and what is fetched for an
		// actor or an object are audit-log.svelte.spec.ts's, and the server's
		// filtering is the Go audit tests'.
		await actorTrigger.click();
		// alrayyes/Hush-Hush#917: the open menu is its own state, and no scan had
		// it open. The trigger is a combobox that controls the list, and the list
		// is named by the label.
		await expect(page.getByRole('listbox', { name: 'Actor' })).toBeVisible();
		await page.waitForFunction(() => document.getAnimations().length === 0);
		const openSelectResults = await new AxeBuilder({ page })
			.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
			.analyze();
		expect(openSelectResults.violations).toEqual([]);
		// One real pick, to prove the menu is wired to the real page.
		await page.getByRole('option', { name: 'admin', exact: true }).click();
		await expect(page.getByText('actor: admin')).toBeVisible();

		// alrayyes/Hush-Hush#895: the audit log pages 25 at a time with Newer and
		// Older. Twenty-six more reads of one secret push the log past a page.
		const reads = await Promise.all(
			Array.from({ length: 26 }, () =>
				page.request.get('/objects/audit_spec_secret'),
			),
		);
		for (const read of reads) {
			expect(read.ok()).toBe(true);
		}
		await page.goto('/audit-log');
		const auditPages = page.getByRole('navigation', {
			name: 'Audit log pages',
		});
		const newerButton = auditPages.getByRole('button', { name: 'Newer' });
		const olderButton = auditPages.getByRole('button', { name: 'Older' });
		await expect(page.locator('tbody tr')).toHaveCount(25);
		await expect(auditPages.getByText('Showing 25 entries')).toBeVisible();
		await expect(curlSnippet).toContainText('limit=25');
		await expect(newerButton).toBeDisabled();
		await expect(olderButton).toBeEnabled();
		const auditPagerAxe = await new AxeBuilder({ page })
			.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
			.analyze();
		expect(auditPagerAxe.violations).toEqual([]);

		// The paged state in the dark theme too. Finishing the colour transitions
		// first means axe reads the final colours, with no timer.
		await page.evaluate(() =>
			document.documentElement.setAttribute('data-theme', 'dark'),
		);
		await page.evaluate(() =>
			Promise.all(document.getAnimations().map((a) => a.finished)),
		);
		const auditPagerAxeDark = await new AxeBuilder({ page })
			.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
			.analyze();
		expect(auditPagerAxeDark.violations).toEqual([]);
		await page.evaluate(() =>
			document.documentElement.setAttribute('data-theme', 'light'),
		);

		const firstAuditPage = await rowTexts();
		await olderButton.click();
		await expect(newerButton).toBeEnabled();
		await expect.poll(rowTexts).not.toEqual(firstAuditPage);
		await newerButton.click();
		await expect.poll(rowTexts).toEqual(firstAuditPage);

		// alrayyes/Hush-Hush#897: rows per page on the audit log.
		await page.goto('/audit-log');
		const auditSize = auditPages.getByRole('combobox', {
			name: 'Rows per page',
		});
		await expect(auditSize).toHaveText('25');
		// The options, the extra row asked for and the curl command are
		// audit-log.svelte.spec.ts's. What this proves is that picking one really
		// changes the address, and that the address is what a reload and a link
		// read back.
		await auditSize.click();
		await page.getByRole('option', { name: '50', exact: true }).click();
		await expect(page).toHaveURL(/[?&]size=50(&|$)/);
		await expect(auditSize).toHaveText('50');
		await page.reload();
		await expect(auditSize).toHaveText('50');
		// The size is the address's: following the nav link to /audit-log, which
		// has no ?size=, goes back to the default and shows 25 rows again.
		await nav.getByRole('link', { name: /audit log/i }).click();
		await expect(page).not.toHaveURL(/size=/);
		await expect(auditSize).toHaveText('25');
		await expect(page.locator('tbody tr')).toHaveCount(25);
		await expect(olderButton).toBeEnabled();
	} finally {
		const removed = await page.request.delete('/objects/audit_spec_secret', {
			headers,
		});
		// Already gone is fine: a seed that failed leaves nothing to remove.
		expect([200, 204, 404]).toContain(removed.status());
	}
});
