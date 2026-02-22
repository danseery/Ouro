"""Entry point for Ouro."""

from ouro.app import OuroApp


def main() -> None:
    app = OuroApp()
    app.run()


if __name__ == "__main__":
    main()
