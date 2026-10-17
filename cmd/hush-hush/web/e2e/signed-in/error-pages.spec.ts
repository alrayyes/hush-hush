import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

// What each error page says and links to is error.svelte.spec.ts's. What is
// left is that the real app reaches them inside the signed-in shell: a path no
// route matches, and a failing load (the secrets list aborted), with no
// internals in the page source.
test('a path no route matches and a failed load reach the error page in the signed-in shell', async ({
	page,
}) => {
	// #790: a path no route matches shows the 404 page inside the signed-in
	// shell, and a load that fails shows the 500 page with no internals.
	await page.goto('/no/such/page');
	// What the page says besides its heading, and where it links, is
	// error.svelte.spec.ts's; here it has to be the page an unmatched path
	// reaches, inside the signed-in shell.
	await expect(
		page.getByRole('heading', { level: 1, name: 'Page not found' }),
	).toBeVisible();
	await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
	// The signed-in variant follows the root layout's session, which the
	// component test stubs.
	await expect(page.getByRole('link', { name: 'Open secrets' })).toBeVisible();
	const notFoundResults = await new AxeBuilder({ page })
		.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
		.analyze();
	expect(notFoundResults.violations).toEqual([]);

	await page.route('**/objects?*', (route) => route.abort());
	await page.goto('/');
	await expect(
		page.getByRole('heading', { level: 1, name: 'Something went wrong' }),
	).toBeVisible();
	await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
	expect(await page.content()).not.toMatch(
		/\bat \S+\.(js|ts|svelte)|node_modules/,
	);
	const failedResults = await new AxeBuilder({ page })
		.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
		.analyze();
	expect(failedResults.violations).toEqual([]);
	await page.unroute('**/objects?*');
	await page.goto('/');
	await expect(page.getByRole('button', { name: 'New secret' })).toBeVisible();
});
