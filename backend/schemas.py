"""Request schemas and field-level validation for the invoice API."""

import re
from datetime import date
from decimal import Decimal

from pydantic import BaseModel, Field, field_validator, model_validator


class LineItemIn(BaseModel):
    description: str = Field(min_length=1, max_length=250)
    quantity: Decimal = Field(gt=0, max_digits=12, decimal_places=4)
    unit_price: Decimal = Field(ge=0, max_digits=12, decimal_places=2)

    @field_validator("description")
    @classmethod
    def clean_description(cls, value):
        value = value.strip()
        if not value:
            raise ValueError("Description cannot be blank.")
        return value


class CustomFieldIn(BaseModel):
    label: str = Field(max_length=100)
    value: str = Field(max_length=500)
    visible: bool = True


class InvoiceIn(BaseModel):
    invoice_number: str = Field(min_length=1, max_length=60)
    business_name: str = Field(min_length=1, max_length=180)
    business_email: str = Field(default="", max_length=254)
    business_address: str = Field(default="", max_length=1000)
    client_name: str = Field(min_length=1, max_length=180)
    client_email: str = Field(min_length=3, max_length=254)
    client_address: str = Field(default="", max_length=1000)
    issue_date: date
    due_date: date
    notes: str = Field(default="", max_length=3000)
    discount: Decimal = Field(ge=0, max_digits=12, decimal_places=2)
    tax_rate: Decimal = Field(ge=0, le=100, max_digits=6, decimal_places=3)
    items: list[LineItemIn] = Field(min_length=1, max_length=100)
    custom_fields: list[CustomFieldIn] = Field(default_factory=list, max_length=50)

    @field_validator("invoice_number", "business_name", "client_name")
    @classmethod
    def non_blank(cls, value):
        value = value.strip()
        if not value:
            raise ValueError("This field cannot be blank.")
        return value

    @model_validator(mode="after")
    def validate_date_order(self):
        if self.due_date < self.issue_date:
            raise ValueError("Due date cannot be earlier than issue date.")
        return self

    @field_validator("business_email", "client_email")
    @classmethod
    def validate_email_format(cls, value, info):
        value = value.strip()
        if info.field_name == "business_email" and not value:
            return value
        if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", value):
            raise ValueError(f"{info.field_name.replace('_', ' ').title()} must be a valid email.")
        return value
