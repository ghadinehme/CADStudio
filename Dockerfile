# Studio CAD — container image (conda-based for a reliable CadQuery/OCCT build).
FROM continuumio/miniconda3

WORKDIR /app
COPY environment.yml .
RUN conda env create -f environment.yml && conda clean -afy

# run everything inside the studio-cad env
SHELL ["conda", "run", "--no-capture-output", "-n", "studio-cad", "/bin/bash", "-c"]

COPY . .

ENV PORT=5001
EXPOSE 5001
CMD ["conda", "run", "--no-capture-output", "-n", "studio-cad", "python", "server.py"]
