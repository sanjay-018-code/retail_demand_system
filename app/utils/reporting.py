"""
Export & Reporting Service
==========================
Requirement #31: Export dashboard views (Overview, Forecasts, Movers, Alerts, Purchase Orders)
to CSV and PDF format.
"""
import io
import pandas as pd
from reportlab.lib.pagesizes import letter
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib import colors


def export_dataframe_csv(df: pd.DataFrame) -> bytes:
    """Exports a pandas DataFrame to CSV bytes."""
    output = io.StringIO()
    df.to_csv(output, index=False)
    return output.getvalue().encode("utf-8")


def generate_pdf_report(title: str, summary_kpis: dict, table_data: list, col_names: list) -> bytes:
    """
    Generates a professional PDF report containing a title, summary KPIs, and a data table.
    """
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=letter, rightMargin=36, leftMargin=36, topMargin=36, bottomMargin=36)
    styles = getSampleStyleSheet()
    
    title_style = ParagraphStyle(
        'TitleStyle',
        parent=styles['Heading1'],
        fontSize=18,
        leading=22,
        textColor=colors.HexColor("#1e293b"),
        spaceAfter=12
    )
    
    body_style = styles['BodyText']
    elements = []
    
    # Title
    elements.append(Paragraph(f"<b>{title}</b>", title_style))
    elements.append(Paragraph(f"Generated at: {pd.Timestamp.now().strftime('%Y-%m-%d %H:%M:%S')}", body_style))
    elements.append(Spacer(1, 14))
    
    # KPI Summary section
    if summary_kpis:
        kpi_text = " &bull; ".join([f"<b>{k}:</b> {v}" for k, v in summary_kpis.items()])
        elements.append(Paragraph(kpi_text, body_style))
        elements.append(Spacer(1, 14))

    # Table section
    if table_data:
        formatted_table = [[Paragraph(f"<b>{c}</b>", body_style) for c in col_names]]
        for row in table_data:
            formatted_table.append([Paragraph(str(val), body_style) for val in row])
            
        t = Table(formatted_table, repeatRows=1)
        t.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor("#f1f5f9")),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.HexColor("#0f172a")),
            ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
            ('TOPPADDING', (0, 0), (-1, -1), 6),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e1")),
        ]))
        elements.append(t)
        
    doc.build(elements)
    buffer.seek(0)
    return buffer.getvalue()
