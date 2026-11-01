"""Point d'entrée du moteur (utilisé par PyInstaller et par les scripts de lancement)."""
import multiprocessing
import sys

if __name__ == "__main__":
    multiprocessing.freeze_support()
    sys.argv = [sys.argv[0]] + [a for a in sys.argv[1:]]
    from genealis.main import main

    main()
