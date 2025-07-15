# Contributing to auto-merge

Thank you for your interest in contributing to auto-merge! This document provides guidelines and instructions for contributing.

## Development Setup

### Prerequisites

- Node.js 20.x or higher
- npm or nix with direnv

### Getting Started

1. Fork and clone the repository:

   ```bash
   git clone https://github.com/YOUR_USERNAME/auto-merge.git
   cd auto-merge
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

   Or if using Nix:

   ```bash
   nix develop
   # or with direnv
   direnv allow
   ```

### Development Commands

- `npm run build` - Build the action (required before committing)
- `npm run watch` - Watch mode for development
- `npm run lint` - Check code formatting
- `npm run prettier` - Format code

### Nix-specific Commands

- `nix fmt` - Format Nix files
- `./scripts/update-vendored-deps.sh` - Update vendored dependencies

## Making Changes

### Code Style

- Use Prettier for formatting (2 spaces, semicolons, single quotes)
- Follow existing patterns and conventions in the codebase
- Keep the code simple and maintainable

### Important Notes

1. **Always run `npm run build`** before committing - the `dist/` directory must be updated
2. The built file `dist/index.js` must be committed with your changes
3. Use the existing libraries and patterns - don't introduce new dependencies without discussion

### Commit Messages

- Use clear, descriptive commit messages
- Follow conventional commit format when possible
- Reference issues in commit messages when applicable

## Pull Request Process

1. Create a new branch for your changes:

   ```bash
   git checkout -b feature/your-feature-name
   ```

2. Make your changes and ensure:
   - Code is formatted (`npm run prettier`)
   - Linting passes (`npm run lint`)
   - Build succeeds (`npm run build`)
   - The `dist/` directory is updated and committed

3. Push your branch and create a pull request

4. Ensure your PR:
   - Has a clear title and description
   - References any related issues
   - Includes any necessary documentation updates

## Testing

Currently, there is no test suite. When making changes:

- Manually test your changes in a real GitHub Actions environment
- Consider edge cases and error scenarios
- Ensure backward compatibility

## Architecture Overview

- `src/index.ts` - Entry point with error handling
- `src/run.ts` - Main logic for GitHub API integration
- `src/result.ts` - Result enum definitions
- `dist/index.js` - Built distribution (must be committed)

The action uses:

- `@actions/github` and `@octokit` for GitHub API
- `@vercel/ncc` for bundling
- TypeScript for type safety

## Questions?

Feel free to open an issue for any questions or concerns about contributing.
