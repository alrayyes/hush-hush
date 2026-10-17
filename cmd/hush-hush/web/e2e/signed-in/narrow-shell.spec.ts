import { expect, test } from '@playwright/test';

// The shared chrome and each authenticated page at the narrowest width. The
// top bar's controls sit in at most two rows (#294, #481), and no page has a
// horizontally scrollable element of its own, which a document-level check
// misses because a table with overflow-x: auto scrolls inside its box. Layout,
// so it needs a browser. The nav is the phone tab bar, the only one shown here.
test('at 320px the top bar stays within two rows and no page scrolls sideways', async ({
	page,
}) => {
	await page.goto('/');
	const tabBar = page.getByRole('navigation', { name: 'Primary (mobile)' });

	await page.setViewportSize({ width: 320, height: 720 });

	// #294: the topbar's nav links, theme toggle, and Log out button used
	// to each wrap onto their own line at phone width via `flex-wrap`
	// fighting `margin-left: auto` - four-plus ragged rows before any page
	// content was visible. Clustering every topbar control's own top
	// offset (within a tolerance wider than the few px a link and a
	// padded button can differ by even centered on the same line) catches
	// that without pinning an exact pixel height to font metrics. The nav
	// links themselves moved to the bottom tab bar below md (#480), so what's
	// left in the topbar to cluster is the brand, the instance label, the
	// status pill and the account menu button (#481).
	const topbarControls = [
		page.getByRole('banner').getByText('HUSH-HUSH'),
		page.getByRole('banner').getByText('e2e / local'),
		page.getByRole('banner').getByText('ACTIVE', { exact: true }),
		page.getByRole('banner').getByRole('button', { name: 'Account menu' }),
	];
	const boxes = await Promise.all(
		topbarControls.map((control) => control.boundingBox()),
	);
	const tops: number[] = [];
	for (const box of boxes) {
		expect(
			box,
			'every topbar control should be visible at 320px',
		).not.toBeNull();
		if (box !== null) {
			tops.push(box.y);
		}
	}
	tops.sort((a, b) => a - b);
	const rowTolerancePx = 16;
	let topbarRows = tops.length > 0 ? 1 : 0;
	for (let i = 1; i < tops.length; i++) {
		if (tops[i] - tops[i - 1] > rowTolerancePx) {
			topbarRows++;
		}
	}
	expect(
		topbarRows,
		'topbar controls should read as at most two rows at 320px',
	).toBeLessThanOrEqual(2);

	// Client-side nav clicks, not page.goto() - a hard navigation to
	// /audit-log is its own dedicated test below (#272), and this loop is
	// about the mobile layout, not routing. Via the bottom tab bar: at 320px
	// it's the only nav displayed.
	for (const linkName of ['Secrets', 'Consumers', 'Audit log', 'Settings']) {
		await tabBar.getByRole('link', { name: linkName }).click();
		await expect(page.locator('main')).toBeVisible();

		// Checks every scrollable element on the page, not just the
		// document - a table with overflow-x: auto never overflows the
		// document (it scrolls sideways within its own box instead),
		// which is exactly what let this regression ship unnoticed the
		// first time. Scoped to overflow-x: scroll/auto specifically -
		// overflow: hidden (the visually-hidden <thead> pattern) also
		// reports a scrollWidth/clientWidth mismatch by design, with no
		// visible scrollbar to go with it.
		const widest = await page.evaluate(() =>
			Math.max(
				0,
				...Array.from(document.querySelectorAll('*'))
					.filter((el) =>
						['scroll', 'auto'].includes(getComputedStyle(el).overflowX),
					)
					.map((el) => el.scrollWidth - el.clientWidth),
			),
		);
		expect(
			widest,
			`${linkName} has a horizontally scrollable element at 320px`,
		).toBe(0);
	}
});
